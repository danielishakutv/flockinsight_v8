import "server-only";
import { and, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { deleteMedia } from "@/lib/media";

/**
 * Sweeping away media that has expired.
 *
 * Its own file, and that is the point: `deleteMedia` reaches lib/media-store,
 * which opens files on disk, and Next traces that into the bundle of anything
 * that imports it — even through a dynamic import. Keeping it out of
 * image-presets.ts means the studio page, which only ever READS a preset, does
 * not drag the filesystem layer into its server bundle.
 *
 * Called once a day by /api/cron/storage.
 */
/**
 * Remove media whose expiry has passed.
 *
 * Only ever rows that CARRY an expiry — which is only ever a derivative the
 * studio saved. A null `expiresAt` is "keep for ever" and is what everything a
 * church uploaded itself has, so this cannot reach a sermon or a member photo
 * however long it has been there.
 *
 * `deleteMedia` is used one row at a time rather than a bulk DELETE, because
 * the bytes live outside the database — on disk or at Cloudinary — and a bulk
 * delete of the rows would free no space at all while making the files
 * unreachable, which is the worst of both.
 */
export async function pruneExpiredMedia(
  now: Date = new Date(),
  limit = 200,
): Promise<{ removed: number; failed: number }> {
  const due = await db
    .select({ id: media.id, churchId: media.churchId })
    .from(media)
    .where(and(isNotNull(media.expiresAt), lt(media.expiresAt, now)))
    .limit(limit);

  let removed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const ok = await deleteMedia(row.id, row.churchId);
      if (ok) removed++;
      else failed++;
    } catch (e) {
      // One unreachable file must not stop the sweep; it will be retried
      // tomorrow, and the reason is in the log rather than swallowed.
      console.error(`[media-prune] could not remove ${row.id}`, e);
      failed++;
    }
  }
  return { removed, failed };
}
