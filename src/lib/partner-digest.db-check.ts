/**
 * The partner-emails job against a real database. Run with `pnpm test:db`.
 *
 * `partner-digest-shared.test.ts` proves the words and the calendar. This file
 * proves what only Postgres can: that the claim row really does stop a second
 * email for the same send day when the job runs twice, that the people who
 * must not get one (opted out, paused, joined an hour ago) do not, that a
 * failed send is retried and then given up on, and that a status email which
 * failed is retried and recorded as delivered.
 *
 * The send days used are in December 2030, so nothing here can collide with
 * a real send day on a development database. The mailer is replaced, so
 * nothing is ever sent. Every row this file writes is a fixture it created
 * (`zzcheck-` users, and digest rows for its own test slots), and it removes
 * only those.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

const outbox: { to: string; subject: string }[] = [];
let failSends = 0;
/**
 * When set, only sends to this address fail. The status retry walks every
 * Partner owed an email, and another check's fixture can be owed one at the
 * same moment; an unscoped failure would land on whichever comes first.
 */
let failOnlyFor: string | null = null;
vi.mock("@/lib/mailer", () => ({
  emailLayout: (title: string, body: string) => `${title}\n${body}`,
  sendEmail: async (m: { to: string; subject: string }) => {
    if (failSends > 0 && (!failOnlyFor || m.to === failOnlyFor)) {
      failSends--;
      return false;
    }
    outbox.push({ to: m.to, subject: m.subject });
    return true;
  },
  sendEmailWithId: async (m: { to: string; subject: string }) => {
    if (failSends > 0 && (!failOnlyFor || m.to === failOnlyFor)) {
      failSends--;
      return { ok: false, id: null, error: "provider unavailable" };
    }
    outbox.push({ to: m.to, subject: m.subject });
    return { ok: true, id: "test" };
  },
}));

import { db } from "@/db";
import { partner, partnerDigest, platformSetting, user } from "@/db/schema";
import {
  digestUnsubToken,
  retryStatusEmails,
  runPartnerDigests,
  sendPartnerDigest,
  setDigestOptOut,
  setPartnerDigestEnabled,
  verifyDigestUnsub,
} from "@/lib/partner-digest";

const STAMP = Date.now().toString(36);
const MONDAY = new Date("2030-12-02T08:15:00Z"); // 09:15 Lagos
const THURSDAY = new Date("2030-12-05T08:15:00Z");
const TUESDAY = new Date("2030-12-03T08:15:00Z");
const SLOTS = ["2030-12-02", "2030-12-05"];

const people = {
  active: `zzcheck-dg-active-${STAMP}`,
  optedOut: `zzcheck-dg-optout-${STAMP}`,
  paused: `zzcheck-dg-paused-${STAMP}`,
  brandNew: `zzcheck-dg-new-${STAMP}`,
  flaky: `zzcheck-dg-flaky-${STAMP}`,
};
const ids: Record<keyof typeof people, string> = {
  active: "",
  optedOut: "",
  paused: "",
  brandNew: "",
  flaky: "",
};
const email = (k: keyof typeof people) => `${people[k]}@example.com`;
let hadSwitch: string | null = null;

async function rowsFor(k: keyof typeof people, slot?: string) {
  return db
    .select()
    .from(partnerDigest)
    .where(
      and(
        eq(partnerDigest.partnerId, ids[k]),
        ...(slot ? [eq(partnerDigest.slot, slot)] : []),
      ),
    );
}

beforeAll(async () => {
  const [sw] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, "partner_digest_enabled"))
    .limit(1);
  hadSwitch = sw?.value ?? null;
  await setPartnerDigestEnabled(true);

  const longAgo = new Date("2026-01-01T00:00:00Z");
  for (const [k, uid] of Object.entries(people) as [keyof typeof people, string][]) {
    await db.insert(user).values({ id: uid, name: `Digest ${k}`, email: email(k) });
    const [p] = await db
      .insert(partner)
      .values({
        userId: uid,
        code: `ZD${k.slice(0, 2).toUpperCase()}${STAMP.toUpperCase().slice(-4)}`,
        displayName: `Digest ${k}`,
        status: k === "paused" ? "paused" : "active",
        // Joined an hour before the Monday run, for the "brand new" case.
        createdAt: k === "brandNew" ? new Date(MONDAY.getTime() - 3_600_000) : longAgo,
        digestOptOutAt: k === "optedOut" ? longAgo : null,
      })
      .returning({ id: partner.id });
    ids[k] = p.id;
  }
});

afterAll(async () => {
  // Digest rows cascade from the partner, which cascades from the user; the
  // test slots are cleared too, for any other partner on this database.
  await db.delete(partnerDigest).where(inArray(partnerDigest.slot, SLOTS));
  await db.delete(partnerDigest).where(like(partnerDigest.slot, "zzcheck-%"));
  await db.delete(user).where(inArray(user.id, Object.values(people)));
  if (hadSwitch === null) {
    await db.delete(platformSetting).where(eq(platformSetting.key, "partner_digest_enabled"));
  } else {
    await setPartnerDigestEnabled(hadSwitch !== "false");
  }
});

describe("the twice-weekly progress email", () => {
  it("does nothing on a day that is not a send day", async () => {
    const res = await runPartnerDigests(TUESDAY);
    expect(res.slot).toBeNull();
    expect(res.skipped).toMatch(/not a send window/);
  });

  it("sends once to an active Partner, and not to the ones who must not get it", async () => {
    outbox.length = 0;
    const res = await runPartnerDigests(MONDAY);
    expect(res.slot).toBe("2030-12-02");

    const [mine] = await rowsFor("active", "2030-12-02");
    expect(mine?.status).toBe("sent");
    expect(mine?.segment).toBe("first_steps");
    expect(outbox.filter((m) => m.to === email("active"))).toHaveLength(1);

    for (const k of ["optedOut", "paused", "brandNew"] as const) {
      expect(await rowsFor(k)).toHaveLength(0);
      expect(outbox.some((m) => m.to === email(k))).toBe(false);
    }
  });

  it("never sends a second email for the same day when the job runs again", async () => {
    outbox.length = 0;
    await runPartnerDigests(new Date(MONDAY.getTime() + 3_600_000)); // the 10:15 tick
    expect(outbox.some((m) => m.to === email("active"))).toBe(false);
    expect(await rowsFor("active", "2030-12-02")).toHaveLength(1);
  });

  it("sends again on the Thursday, with a different tip and subject", async () => {
    outbox.length = 0;
    await runPartnerDigests(THURSDAY);
    const thursday = outbox.filter((m) => m.to === email("active"));
    expect(thursday).toHaveLength(1);
    const [monday] = await rowsFor("active", "2030-12-02");
    expect(thursday[0].subject).not.toBe(monday.subject);
  });

  it("retries a failed send later that day, then gives up after three tries", async () => {
    const slot = `zzcheck-flaky-${STAMP}`;
    failSends = 1;
    const first = await sendPartnerDigest({ partnerId: ids.flaky, slot, slotIndex: 0 });
    expect(first.outcome).toBe("failed");
    expect((await rowsFor("flaky", slot))[0]).toMatchObject({ status: "failed", attempts: 1 });

    const second = await sendPartnerDigest({ partnerId: ids.flaky, slot, slotIndex: 0 });
    expect(second.outcome).toBe("sent");
    expect((await rowsFor("flaky", slot))[0]).toMatchObject({ status: "sent", attempts: 2 });

    // A sent day is never sent again.
    const third = await sendPartnerDigest({ partnerId: ids.flaky, slot, slotIndex: 0 });
    expect(third.outcome).toBe("skipped");

    const capped = `zzcheck-capped-${STAMP}`;
    failSends = 3;
    for (let i = 0; i < 3; i++) {
      expect((await sendPartnerDigest({ partnerId: ids.flaky, slot: capped, slotIndex: 0 })).outcome).toBe(
        "failed",
      );
    }
    failSends = 0;
    expect((await sendPartnerDigest({ partnerId: ids.flaky, slot: capped, slotIndex: 0 })).outcome).toBe(
      "skipped",
    );
  });

  it("stops when the Partner opts out, and the switch stops everybody", async () => {
    expect(await setDigestOptOut(ids.active, true)).toBe(true);
    expect(await setDigestOptOut(ids.active, true)).toBe(false); // already off
    await setDigestOptOut(ids.active, false);

    await setPartnerDigestEnabled(false);
    const res = await runPartnerDigests(MONDAY);
    expect(res.skipped).toMatch(/turned off/);
    await setPartnerDigestEnabled(true);
  });

  it("only accepts an unsubscribe link signed for that Partner", () => {
    expect(verifyDigestUnsub(ids.active, digestUnsubToken(ids.active))).toBe(true);
    expect(verifyDigestUnsub(ids.active, digestUnsubToken(ids.paused))).toBe(false);
    expect(verifyDigestUnsub(ids.active, "nonsense")).toBe(false);
  });
});

describe("status emails that did not go through", () => {
  it("are retried, and recorded as delivered once one is accepted", async () => {
    const changedAt = new Date(Date.now() - 3_600_000);
    await db
      .update(partner)
      .set({ status: "paused", statusPrevious: "active", statusChangedAt: changedAt, statusNotifiedAt: null })
      .where(eq(partner.id, ids.paused));

    outbox.length = 0;
    failSends = 1;
    failOnlyFor = email("paused");
    await retryStatusEmails();
    failOnlyFor = null;
    let [p] = await db.select().from(partner).where(eq(partner.id, ids.paused));
    expect(p.statusNotifiedAt).toBeNull();

    await retryStatusEmails();
    [p] = await db.select().from(partner).where(eq(partner.id, ids.paused));
    expect(p.statusNotifiedAt).not.toBeNull();
    expect(outbox.filter((m) => m.to === email("paused"))).toHaveLength(1);
    expect(outbox.find((m) => m.to === email("paused"))?.subject).toMatch(/paused/i);

    // Told: the next hour sends nothing.
    outbox.length = 0;
    await retryStatusEmails();
    expect(outbox.some((m) => m.to === email("paused"))).toBe(false);
  });

  it("leaves a change made minutes ago to the request that made it", async () => {
    await db
      .update(partner)
      .set({ statusChangedAt: new Date(Date.now() - 60_000), statusNotifiedAt: null })
      .where(eq(partner.id, ids.paused));
    outbox.length = 0;
    await retryStatusEmails();
    expect(outbox.some((m) => m.to === email("paused"))).toBe(false);
  });

  it("gives up after three days", async () => {
    await db
      .update(partner)
      .set({ statusChangedAt: new Date(Date.now() - 4 * 86_400_000), statusNotifiedAt: null })
      .where(eq(partner.id, ids.paused));
    outbox.length = 0;
    await retryStatusEmails();
    expect(outbox.some((m) => m.to === email("paused"))).toBe(false);
  });
});
