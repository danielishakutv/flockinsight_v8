/**
 * Direct-upload tickets against a real database. Run with `pnpm test:db`.
 *
 * The hole these close: a ticket for Cloudinary used to be a signature and
 * nothing else, so an upload that never reached /complete was counted against
 * nobody, and tickets could be had without limit. Asserted here:
 *
 *  - two tickets asked for at the same moment cannot both take the last room
 *    (two interleaved transactions over ONE church's quota lock, not a
 *    Promise.all that happens to serialise);
 *  - a church cannot hold more than MAX_OPEN_TICKETS;
 *  - /complete closes a ticket once, and a reaped one is refused;
 *  - the sweep reaps only open, long-expired tickets, and never one whose asset
 *    has a media row.
 *
 * Creates its own church ("zzcheck-tickets-…") and removes exactly what it
 * created, by id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { church, media, mediaOrphan, mediaUploadTicket } from "@/db/schema";
import { getStorageInfo } from "@/lib/storage";
import {
  closeUploadTicket,
  issueUploadTicket,
  lockChurchMediaQuota,
  reapAbandonedUploadTickets,
} from "@/lib/media-upload-tickets";
import { MAX_OPEN_TICKETS, REAP_AFTER_EXPIRY_MS } from "@/lib/media-upload-ticket-rules";

const stamp = Date.now();
const churchId = `zzcheck-tickets-${stamp}`;
const folder = `flockinsight/${churchId}`;
const mediaIds: string[] = [];
let limit = 0;
let n = 0;

const pid = () => `${folder}/zzcheck-${stamp}-${++n}`;

async function ticketIds(): Promise<string[]> {
  const rows = await db
    .select({ id: mediaUploadTicket.id })
    .from(mediaUploadTicket)
    .where(eq(mediaUploadTicket.churchId, churchId));
  return rows.map((r) => r.id);
}

/** Close every open ticket so the next test starts with room and slots. */
async function closeAll() {
  const ids = await ticketIds();
  if (ids.length)
    await db
      .update(mediaUploadTicket)
      .set({ status: "completed", closedAt: new Date() })
      .where(inArray(mediaUploadTicket.id, ids));
}

beforeAll(async () => {
  await db
    .insert(church)
    .values({ id: churchId, name: `Ticket Check ${stamp}`, slug: churchId, currency: "NGN" })
    .onConflictDoNothing();
  limit = (await getStorageInfo(churchId, 0)).limit;
});

afterAll(async () => {
  const ids = await ticketIds();
  if (ids.length) await db.delete(mediaUploadTicket).where(inArray(mediaUploadTicket.id, ids));
  if (mediaIds.length) await db.delete(media).where(inArray(media.id, mediaIds));
  // The sweep may have written orphans for this check's (never-uploaded) ids
  // when Cloudinary is not configured here. Only ours, by id.
  const orphans = await db
    .select({ id: mediaOrphan.id })
    .from(mediaOrphan)
    .where(like(mediaOrphan.publicId, `${folder}/zzcheck-%`));
  if (orphans.length)
    await db.delete(mediaOrphan).where(inArray(mediaOrphan.id, orphans.map((o) => o.id)));
  await db.delete(church).where(eq(church.id, churchId));
});

describe("two tickets for the last of the room", () => {
  it("lets exactly one through when they are asked for at the same moment", async () => {
    await closeAll();
    const big = Math.floor(limit * 0.6);

    // A takes the church's quota lock and holds it; B is started while A
    // holds it and must wait — then see A's reservation.
    let aHasLock!: () => void;
    const aLocked = new Promise<void>((r) => (aHasLock = r));
    let letAGo!: () => void;
    const aMayFinish = new Promise<void>((r) => (letAGo = r));

    const holder = db.transaction(async (tx) => {
      await lockChurchMediaQuota(tx, churchId);
      aHasLock();
      await aMayFinish;
    });
    await aLocked;
    const first = issueUploadTicket({
      churchId,
      storageExtraBytes: 0,
      publicId: pid(),
      resourceType: "video",
      bytes: big,
      userId: null,
    });
    const second = issueUploadTicket({
      churchId,
      storageExtraBytes: 0,
      publicId: pid(),
      resourceType: "video",
      bytes: big,
      userId: null,
    });
    await new Promise((r) => setTimeout(r, 300));
    letAGo();
    await holder;

    const verdicts = await Promise.all([first, second]);
    expect(verdicts.filter((v) => v.ok)).toHaveLength(1);
    const refused = verdicts.find((v) => !v.ok);
    expect(refused && !refused.ok && refused.code).toBe("quota");
  });
});

describe("how many may be open", () => {
  it("refuses the one past the cap, however small it claims to be", async () => {
    await closeAll();
    for (let i = 0; i < MAX_OPEN_TICKETS; i++) {
      const v = await issueUploadTicket({
        churchId,
        storageExtraBytes: 0,
        publicId: pid(),
        resourceType: "image",
        bytes: 1,
        userId: null,
      });
      expect(v.ok).toBe(true);
    }
    const over = await issueUploadTicket({
      churchId,
      storageExtraBytes: 0,
      publicId: pid(),
      resourceType: "image",
      bytes: 1,
      userId: null,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("busy");
  });

  it("does not count an expired ticket as open", async () => {
    await closeAll();
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    for (let i = 0; i < MAX_OPEN_TICKETS; i++)
      await issueUploadTicket({
        churchId,
        storageExtraBytes: 0,
        publicId: pid(),
        resourceType: "image",
        bytes: 1,
        userId: null,
      });
    // Two hours on, every one of those signatures is dead.
    const v = await issueUploadTicket({
      churchId,
      storageExtraBytes: 0,
      publicId: pid(),
      resourceType: "image",
      bytes: 1,
      userId: null,
      now: later,
    });
    expect(v.ok).toBe(true);
  });
});

describe("closing a ticket at /complete", () => {
  it("closes it once, then reports the repeat", async () => {
    await closeAll();
    const p = pid();
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: p, resourceType: "raw", bytes: 10, userId: null });
    expect(await db.transaction((tx) => closeUploadTicket(tx, churchId, p))).toBe("open");
    expect(await db.transaction((tx) => closeUploadTicket(tx, churchId, p))).toBe("completed");
  });

  it("will not close another church's ticket", async () => {
    const p = pid();
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: p, resourceType: "raw", bytes: 10, userId: null });
    expect(await db.transaction((tx) => closeUploadTicket(tx, "zzcheck-not-this-church", p))).toBe("none");
    await closeAll();
  });

  it("reports a reaped ticket, so its asset is never filed", async () => {
    await closeAll();
    const p = pid();
    const old = new Date(Date.now() - 24 * 60 * 60_000);
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: p, resourceType: "raw", bytes: 10, userId: null, now: old });
    await reapAbandonedUploadTickets(new Date());
    expect(await db.transaction((tx) => closeUploadTicket(tx, churchId, p))).toBe("reaped");
  });
});

describe("the sweep", () => {
  it("reaps an open ticket long past expiry, but not a fresh one or a filed one", async () => {
    await closeAll();
    const now = new Date();
    const longAgo = new Date(now.getTime() - REAP_AFTER_EXPIRY_MS - 2 * 60 * 60_000);
    const abandoned = pid();
    const fresh = pid();
    const filed = pid();
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: abandoned, resourceType: "raw", bytes: 10, userId: null, now: longAgo });
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: fresh, resourceType: "raw", bytes: 10, userId: null, now });
    await issueUploadTicket({ churchId, storageExtraBytes: 0, publicId: filed, resourceType: "raw", bytes: 10, userId: null, now: longAgo });
    // The filed one has a media row: completed, its answer lost.
    const [row] = await db
      .insert(media)
      .values({ churchId, kind: "file", mime: "application/pdf", size: 10, bytes: 10, provider: "cloudinary", publicId: filed, resourceType: "raw" })
      .returning({ id: media.id });
    mediaIds.push(row.id);

    await reapAbandonedUploadTickets(now);

    const status = async (p: string) =>
      (
        await db
          .select({ status: mediaUploadTicket.status })
          .from(mediaUploadTicket)
          .where(and(eq(mediaUploadTicket.churchId, churchId), eq(mediaUploadTicket.publicId, p)))
      )[0]?.status;
    expect(await status(abandoned)).toBe("reaped");
    expect(await status(fresh)).toBe("open");
    expect(await status(filed)).toBe("completed");
  });
});
