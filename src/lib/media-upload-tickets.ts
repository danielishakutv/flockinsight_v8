import "server-only";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, mediaUploadTicket } from "@/db/schema";
import { destroyFromCloudinary, type ResourceType } from "@/lib/cloudinary";
import { rememberOrphan } from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import {
  REAP_AFTER_EXPIRY_MS,
  TICKET_TTL_MS,
  uploadTicketVerdict,
  type TicketVerdict,
} from "@/lib/media-upload-ticket-rules";

/**
 * Direct-to-Cloudinary upload tickets, kept as rows. See `mediaUploadTicket` in
 * the schema for why, and lib/media-upload-ticket-rules.ts for the decision.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialise every quota decision for one church, for the rest of the caller's
 * transaction.
 *
 * Postgres runs READ COMMITTED, so "is there room? then file it" in two
 * requests at once lets both see the same free space: two completes at
 * 199 of 200 MB each pass and the church ends at 398. Keyed on the CHURCH,
 * not on the asset — a lock on the asset only stops the same file being filed
 * twice. Taken by /media/sign, /media/complete and the meeting recording
 * complete.
 */
export async function lockChurchMediaQuota(tx: Tx, churchId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`media-quota:${churchId}`}))`);
}

/**
 * Hand out a ticket, or say why not. The check and the insert are one
 * transaction under the church's quota lock, so two requests cannot both take
 * the last of the room or the last open slot.
 */
export async function issueUploadTicket(opts: {
  churchId: string;
  storageExtraBytes: number;
  publicId: string;
  resourceType: ResourceType;
  bytes: number;
  userId: string | null;
  now?: Date;
}): Promise<TicketVerdict> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockChurchMediaQuota(tx, opts.churchId);
    /*
     * Grouped aggregate, not a correlated subquery — see the raw-sql qualifier
     * trap in AGENTS.md. Bigint sums come back from the driver as strings.
     */
    const [open] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        reserved: sql<string>`coalesce(sum(${mediaUploadTicket.declaredBytes}), 0)`,
      })
      .from(mediaUploadTicket)
      .where(
        and(
          eq(mediaUploadTicket.churchId, opts.churchId),
          eq(mediaUploadTicket.status, "open"),
          gt(mediaUploadTicket.expiresAt, now),
        ),
      );
    const info = await getStorageInfo(opts.churchId, opts.storageExtraBytes);
    const verdict = uploadTicketVerdict({
      used: info.used,
      limit: info.limit,
      reservedBytes: Number(open?.reserved ?? 0),
      openTickets: Number(open?.n ?? 0),
      bytes: opts.bytes,
    });
    if (!verdict.ok) return verdict;
    await tx.insert(mediaUploadTicket).values({
      churchId: opts.churchId,
      publicId: opts.publicId,
      resourceType: opts.resourceType,
      declaredBytes: opts.bytes,
      expiresAt: new Date(now.getTime() + TICKET_TTL_MS),
      createdBy: opts.userId,
    });
    return verdict;
  });
}

/**
 * Close a ticket at /complete, inside the caller's transaction (and its quota
 * lock). Returns what the ticket WAS:
 *
 *  - "open"      — closed now; file the asset.
 *  - "completed" — a repeat of a complete that already filed it.
 *  - "reaped"    — the storage cron gave up on it and destroyed (or is
 *                  destroying) the asset. Filing it now would make a row that
 *                  points at nothing, so the caller must refuse.
 *  - "none"      — no ticket: one signed before tickets were rows. Filed and
 *                  counted like any other; what tickets close is the upload
 *                  that is never completed, and this one is being completed.
 */
export async function closeUploadTicket(
  tx: Tx,
  churchId: string,
  publicId: string,
  now: Date = new Date(),
): Promise<"open" | "completed" | "reaped" | "none"> {
  const [t] = await tx
    .select({ id: mediaUploadTicket.id, status: mediaUploadTicket.status })
    .from(mediaUploadTicket)
    .where(and(eq(mediaUploadTicket.publicId, publicId), eq(mediaUploadTicket.churchId, churchId)))
    .for("update")
    .limit(1);
  if (!t) return "none";
  if (t.status !== "open") return t.status === "reaped" ? "reaped" : "completed";
  await tx
    .update(mediaUploadTicket)
    .set({ status: "completed", closedAt: now })
    .where(and(eq(mediaUploadTicket.id, t.id), eq(mediaUploadTicket.status, "open")));
  return "open";
}

/**
 * Destroy the assets of tickets nobody completed. For the daily storage cron.
 *
 * Without this, a ticket's upload that never reached /complete — a closed tab,
 * or somebody doing it on purpose — sat in the church's Cloudinary folder for
 * ever, billing the platform and counted against nobody. Each ticket is
 * claimed open → reaped with the status repeated in the UPDATE and the count
 * checked, so a late /complete (which locks the same row) and the sweep cannot
 * both act on it. A ticket whose asset somehow has a media row is closed as
 * completed instead, never destroyed: a row people open is the one thing this
 * must not break.
 */
export async function reapAbandonedUploadTickets(
  now: Date = new Date(),
  limit = 100,
): Promise<{ reaped: number; orphaned: number }> {
  const cutoff = new Date(now.getTime() - REAP_AFTER_EXPIRY_MS);
  const due = await db
    .select()
    .from(mediaUploadTicket)
    .where(and(eq(mediaUploadTicket.status, "open"), lt(mediaUploadTicket.expiresAt, cutoff)))
    .orderBy(asc(mediaUploadTicket.expiresAt))
    .limit(limit);

  let reaped = 0;
  let orphaned = 0;
  for (const t of due) {
    const [filed] = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.churchId, t.churchId), eq(media.publicId, t.publicId)))
      .limit(1);
    const claimed = await db
      .update(mediaUploadTicket)
      .set({ status: filed ? "completed" : "reaped", closedAt: now })
      .where(and(eq(mediaUploadTicket.id, t.id), eq(mediaUploadTicket.status, "open")))
      .returning({ id: mediaUploadTicket.id });
    if (claimed.length === 0 || filed) continue;

    // "not found" counts as gone: a ticket nobody used never made an asset.
    const gone = await destroyFromCloudinary(t.publicId, t.resourceType as ResourceType);
    if (!gone) {
      await rememberOrphan(
        t.churchId,
        t.publicId,
        t.resourceType as ResourceType,
        "upload ticket never completed",
      );
      orphaned++;
    }
    reaped++;
  }
  if (due.length > 0)
    console.log(
      `[media] upload tickets: ${reaped} abandoned upload(s) reaped, ${orphaned} left for the orphan retry`,
    );
  return { reaped, orphaned };
}
