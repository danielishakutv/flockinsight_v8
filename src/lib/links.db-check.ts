/**
 * Database-backed checks for short links. Run with `pnpm test:db`.
 *
 * `links-shared.test.ts` covers the rules with no database. What is checked
 * here is the half that only Postgres can answer, and all three were reasoned
 * about rather than measured when they were written:
 *
 *   1. THE CLICK UPSERT. Counting a click is one `INSERT … ON CONFLICT DO
 *      UPDATE SET clicks = clicks + 1`. Whether that increments the EXISTING
 *      row or re-writes the proposed 1 depends on which `clicks` the bare
 *      column reference means inside DO UPDATE — and getting it wrong pins
 *      every total at 1 for ever, with no error. This is the whole reason the
 *      file exists.
 *   2. THE UNIQUE INDEX on the code, which is what makes the "that code has
 *      just been taken" message possible rather than a 500.
 *   3. THE CASCADES. Deleting a link must take its figures and its destination
 *      history with it, and must NOT take the QR code design somebody spent
 *      twenty minutes on.
 *
 * Cleans up after itself by id, and only the rows it created — see the note in
 * `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  qrCode,
  staff,
  shortLink,
  shortLinkDestination,
  shortLinkStat,
} from "@/db/schema";
import {
  codeTaken,
  createLink,
  destinationHistory,
  freeCode,
  linkStats,
  recordClick,
  resolveCode,
  setLinkStatus,
  updateLink,
  dayKeys,
} from "@/lib/links";
import { saveQrCode } from "@/lib/qr-codes";
import { DEFAULT_DESIGN } from "@/lib/qr/design";

let churchId = "";
let userId: string | null = null;

/** A prefix nothing else will use, so cleanup can find exactly our rows. */
const PREFIX = `zzcheck-${Date.now().toString(36)}`;
const madeLinks: string[] = [];
const madeCodes: string[] = [];

async function makeLink(suffix: string, destination = "https://example.com/a") {
  const code = `${PREFIX}-${suffix}`;
  const res = await createLink({
    churchId,
    code,
    destination,
    title: `Check ${suffix}`,
    note: null,
    expiresAt: null,
    userId: userId!,
  });
  expect(res.ok, res.ok ? "" : res.error).toBe(true);
  if (!res.ok) throw new Error(res.error);
  madeLinks.push(res.id);
  return { id: res.id, code };
}

beforeAll(async () => {
  /*
   * A church that HAS a staff row, found by joining rather than by taking the
   * first church and hoping. `created_by` carries a foreign key, so a church
   * with nobody in it (the first row here turned out to be exactly that)
   * cannot be used — and that is a property of the data, not a failure.
   */
  const [row] = await db
    .select({ churchId: church.id, userId: staff.userId })
    .from(church)
    .innerJoin(staff, eq(staff.organizationId, church.id))
    .limit(1);
  expect(row, "these checks need a church with at least one staff member").toBeTruthy();
  churchId = row.churchId;
  userId = row.userId;
});

afterAll(async () => {
  /*
   * Only the ids this file created, and nothing else.
   *
   * These run against a real database holding a real church's records, so a
   * cleanup written as "delete where code like 'zzcheck%'" would be one typo
   * away from taking somebody's data. Collecting ids on the way in and
   * deleting exactly those on the way out cannot reach anything it did not
   * make. Leaving them behind is not the safer option either: they would show
   * up in that church's own list of links.
   */
  if (madeCodes.length) {
    await db.delete(qrCode).where(inArray(qrCode.id, madeCodes));
  }
  if (madeLinks.length) {
    await db.delete(shortLink).where(inArray(shortLink.id, madeLinks));
  }
});

/* ============================================================
 * Counting a click
 * ========================================================== */

describe("counting a click", () => {
  it("increments the existing total rather than overwriting it", async () => {
    /*
     * THE ONE THAT MATTERS. `ON CONFLICT DO UPDATE SET clicks = clicks + 1`
     * reads the stored row on the right-hand side; `excluded.clicks` would be
     * the 1 just offered, and every bucket in the product would sit at 1 for
     * ever with nothing in any log to say so.
     */
    const link = await makeLink("clicks");
    const day = dayKeys(1)[0];

    for (let i = 0; i < 5; i++) {
      await recordClick({
        linkId: link.id,
        churchId,
        day,
        source: "qr",
        device: "phone",
      });
    }

    const rows = await db
      .select({
        bucket: shortLinkStat.bucket,
        key: shortLinkStat.key,
        clicks: shortLinkStat.clicks,
      })
      .from(shortLinkStat)
      .where(eq(shortLinkStat.linkId, link.id));

    // Three buckets, one row each — not fifteen rows, and not three rows of 1.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.clicks, `${row.bucket}/${row.key}`).toBe(5);
    }

    const [stored] = await db
      .select({ total: shortLink.clickCount, last: shortLink.lastClickAt })
      .from(shortLink)
      .where(eq(shortLink.id, link.id));
    expect(stored.total).toBe(5);
    expect(stored.last).not.toBeNull();
  });

  it("keeps separate totals per day, per source and per device", async () => {
    const link = await makeLink("buckets");
    const [today, yesterday] = [dayKeys(1)[0], dayKeys(2)[0]];

    await recordClick({ linkId: link.id, churchId, day: yesterday, source: "qr", device: "phone" });
    await recordClick({ linkId: link.id, churchId, day: today, source: "qr", device: "phone" });
    await recordClick({ linkId: link.id, churchId, day: today, source: "facebook.com", device: "computer" });

    const stats = await linkStats(churchId, link.id, 30);
    expect(stats.total).toBe(3);

    const byDay = new Map(stats.byDay.map((d) => [d.day, d.clicks]));
    expect(byDay.get(today)).toBe(2);
    expect(byDay.get(yesterday)).toBe(1);

    const sources = new Map(stats.sources.map((s) => [s.key, s.clicks]));
    expect(sources.get("qr")).toBe(2);
    expect(sources.get("facebook.com")).toBe(1);

    const devices = new Map(stats.devices.map((d) => [d.key, d.clicks]));
    expect(devices.get("phone")).toBe(2);
    expect(devices.get("computer")).toBe(1);
  });

  it("fills in the empty days, so a Sunday spike reads as a spike", async () => {
    const link = await makeLink("window");
    await recordClick({
      linkId: link.id,
      churchId,
      day: dayKeys(1)[0],
      source: "direct",
      device: "phone",
    });
    const stats = await linkStats(churchId, link.id, 30);
    expect(stats.byDay).toHaveLength(30);
    expect(stats.byDay.filter((d) => d.clicks === 0)).toHaveLength(29);
  });

  it("never throws for a link that has gone", async () => {
    // The redirect hands this to `after()`, and a church deleting a link while
    // somebody is mid-scan must not produce an unhandled rejection.
    await expect(
      recordClick({
        linkId: "00000000-0000-0000-0000-000000000000",
        churchId,
        day: dayKeys(1)[0],
        source: "direct",
        device: "phone",
      }),
    ).resolves.toBeUndefined();
  });
});

/* ============================================================
 * Codes
 * ========================================================== */

describe("codes", () => {
  it("refuses a duplicate with a sentence rather than throwing", async () => {
    const link = await makeLink("dupe");
    const again = await createLink({
      churchId,
      code: link.code,
      destination: "https://example.com/b",
      title: null,
      note: null,
      expiresAt: null,
      userId: userId!,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("taken");
  });

  it("knows whether a code is taken, ignoring the link that holds it", async () => {
    const link = await makeLink("taken");
    expect(await codeTaken(link.code)).toBe(true);
    expect(await codeTaken(link.code, link.id)).toBe(false);
    expect(await codeTaken(`${PREFIX}-never`)).toBe(false);
  });

  it("suggests a code that is actually free", async () => {
    const link = await makeLink("suggest");
    const suggested = await freeCode(link.code);
    expect(suggested).not.toBe(link.code);
    expect(await codeTaken(suggested)).toBe(false);
  });

  it("resolves a code to its destination, and tidies what is passed in", async () => {
    const link = await makeLink("resolve", "https://example.com/resolved");
    const found = await resolveCode(link.code.toUpperCase());
    expect(found?.destination).toBe("https://example.com/resolved");
    expect(found?.churchId).toBe(churchId);
    expect(await resolveCode("no-such-code-anywhere")).toBeNull();
    expect(await resolveCode("")).toBeNull();
  });
});

/* ============================================================
 * Destination history
 * ========================================================== */

describe("the destination history", () => {
  it("records the first address as well as the changes", async () => {
    // A history that starts at the first CHANGE cannot answer "what did this
    // link originally do", which is the question somebody actually asks.
    const link = await makeLink("history", "https://example.com/first");
    const history = await destinationHistory(churchId, link.id);
    expect(history).toHaveLength(1);
    expect(history[0].destination).toBe("https://example.com/first");
  });

  it("adds a row when the destination changes, and not when it does not", async () => {
    const link = await makeLink("repoint", "https://example.com/one");

    const changed = await updateLink({
      churchId,
      id: link.id,
      code: link.code,
      destination: "https://example.com/two",
      title: "Renamed",
      note: null,
      expiresAt: null,
      status: "active",
      userId: userId!,
    });
    expect(changed).toMatchObject({ ok: true, destinationChanged: true });

    const titleOnly = await updateLink({
      churchId,
      id: link.id,
      code: link.code,
      destination: "https://example.com/two",
      title: "Renamed again",
      note: "a note",
      expiresAt: null,
      status: "active",
      userId: userId!,
    });
    expect(titleOnly).toMatchObject({ ok: true, destinationChanged: false });

    const history = await destinationHistory(churchId, link.id);
    expect(history.map((h) => h.destination)).toEqual([
      "https://example.com/two",
      "https://example.com/one",
    ]);
  });

  it("will not let one church edit another's link", async () => {
    const link = await makeLink("tenant");
    const res = await updateLink({
      churchId: "not-a-real-church",
      id: link.id,
      code: link.code,
      destination: "https://evil.example.com",
      title: null,
      note: null,
      expiresAt: null,
      status: "active",
      userId: userId!,
    });
    expect(res.ok).toBe(false);

    const [row] = await db
      .select({ destination: shortLink.destination })
      .from(shortLink)
      .where(eq(shortLink.id, link.id));
    expect(row.destination).not.toContain("evil");
  });

  it("will not let one church change another's status", async () => {
    const link = await makeLink("tenant-status");
    expect(await setLinkStatus("not-a-real-church", link.id, "archived")).toBe(false);
    const [row] = await db
      .select({ status: shortLink.status })
      .from(shortLink)
      .where(eq(shortLink.id, link.id));
    expect(row.status).toBe("active");
  });
});

/* ============================================================
 * What a delete takes with it
 * ========================================================== */

describe("deleting a link", () => {
  it("takes its figures and its history, and leaves the QR design", async () => {
    const link = await makeLink("cascade");
    await recordClick({
      linkId: link.id,
      churchId,
      day: dayKeys(1)[0],
      source: "qr",
      device: "phone",
    });

    const saved = await saveQrCode({
      churchId,
      title: `${PREFIX} design`,
      payload: { kind: "link", url: `https://flockinsight.com/l/${link.code}?s=qr` },
      design: DEFAULT_DESIGN,
      shortLinkId: link.id,
      userId: userId!,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    madeCodes.push(saved.id);

    await db.delete(shortLink).where(eq(shortLink.id, link.id));
    madeLinks.splice(madeLinks.indexOf(link.id), 1);

    expect(
      await db.select().from(shortLinkStat).where(eq(shortLinkStat.linkId, link.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(shortLinkDestination)
        .where(eq(shortLinkDestination.linkId, link.id)),
    ).toHaveLength(0);

    /*
     * The design survives, with no link. `set null` rather than cascade, so
     * twenty minutes of somebody's work is not removed by a tidy-up — the code
     * then shows as pointing at nothing, which is a problem a person can see
     * and fix rather than a row that silently vanished.
     */
    const [design] = await db
      .select({ id: qrCode.id, linkId: qrCode.shortLinkId })
      .from(qrCode)
      .where(and(eq(qrCode.id, saved.id), eq(qrCode.churchId, churchId)));
    expect(design).toBeTruthy();
    expect(design.linkId).toBeNull();
  });
});
