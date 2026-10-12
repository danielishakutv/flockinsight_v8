import "server-only";
import { and, asc, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, mediaOrphan, type Media } from "@/db/schema";
import {
  uploadToCloudinary,
  destroyFromCloudinary,
  isCloudinaryConfigured,
  type ResourceType,
} from "@/lib/cloudinary";
import { can } from "@/lib/permissions";
import {
  refuseWithoutFeature,
  type FeatureRefusal,
} from "@/lib/entitlements-server";
import { sermonNeedsLibraryPlan } from "@/lib/media-upload-rules";

export type MediaKind =
  | "logo"
  | "cover"
  | "photo"
  | "member"
  /**
   * Somebody's own profile picture.
   *
   * Deliberately its own kind rather than "photo" (which needs
   * settings.manage) or "member" (members.manage): a person changing their own
   * face does not need permission over the church. See AVATAR_KIND below.
   */
  | "avatar"
  /**
   * A branded copy made in the photo studio.
   *
   * Its own kind for one reason: it is a DERIVATIVE. The church still has the
   * original, and the point of saving one here is to get a link into a
   * WhatsApp group this week — so these are the only media rows that carry an
   * expiry, and the storage cron removes them after 30 days.
   */
  | "studio"
  | "event"
  | "devotional"
  | "sermon"
  | "receipt"
  | "file";

export const MEDIA_KINDS: MediaKind[] = [
  "logo",
  "cover",
  "photo",
  "member",
  "avatar",
  "studio",
  "event",
  "devotional",
  "sermon",
  "receipt",
  "file",
];

/**
 * The one kind of upload that needs no permission over the church.
 *
 * Both upload paths check this BEFORE asking permForKind, so the rule lives in
 * one place. It is still bounded by everything else: signed in, a real church,
 * the mime whitelist, the size cap and the church's storage quota.
 */
export const AVATAR_KIND: MediaKind = "avatar";

/**
 * Which permission a given upload kind needs. Owners always pass.
 *
 * Lives here rather than in the upload route because there are now two ways a
 * file reaches the library — the simple POST through our origin, and the
 * chunked direct upload that large files take to get past Cloudflare's 100 MB
 * body cap. Two copies of this rule is one copy that will be wrong.
 */
export function permForKind(kind: MediaKind): string {
  switch (kind) {
    case "logo":
    case "cover":
    case "photo":
    case "event":
      return "settings.manage";
    // Never reached through the routes (they allow an avatar before asking),
    // but a caller that forgets gets the strictest answer rather than an open
    // door.
    case "avatar":
      return "settings.manage";
    case "studio":
      return "media.manage";
    case "member":
      return "members.manage";
    case "devotional":
      return "devotionals.manage";
    case "receipt":
      return "contributions.manage";
    default:
      return "media.manage"; // sermon, file
  }
}

/**
 * May the signed-in person upload this kind of file?
 *
 * A photo is the one kind two different teams legitimately add: the media team
 * adds it to the library, and whoever looks after the church's public page adds
 * it to the gallery there. `permForKind` answers with ONE permission, which for
 * photo was settings.manage — so a media-team role with "Media: Upload &
 * delete" picked Photo in the library and was told "You can't upload this."
 * Either permission is enough. Logos, covers and event images stay with
 * settings.manage alone, because they change how the public page looks.
 */
export async function canUploadKind(kind: MediaKind): Promise<boolean> {
  if (kind === "photo")
    return (await can("media.manage")) || (await can("settings.manage"));
  return can(permForKind(kind));
}

/**
 * The plan's answer for this upload, in one place for every route that can
 * create a file. See `sermonNeedsLibraryPlan` for why it is shared, and why a
 * meeting recording is never refused here.
 */
export async function refuseUploadKind(
  kind: MediaKind,
  opts: { recordingId?: string | null } = {},
): Promise<FeatureRefusal | null> {
  if (!sermonNeedsLibraryPlan(kind, opts)) return null;
  return refuseWithoutFeature("mediaLibrary");
}

/** Map a mime type to a Cloudinary resource type (audio rides on "video"). */
export function classifyMime(mime: string): {
  resourceType: ResourceType;
  audio: boolean;
} {
  if (mime.startsWith("image/")) return { resourceType: "image", audio: false };
  if (mime.startsWith("video/")) return { resourceType: "video", audio: false };
  if (mime.startsWith("audio/")) return { resourceType: "video", audio: true };
  return { resourceType: "raw", audio: false };
}

/** A coarse "type" used for filtering/icons in the library UI. */
export function mediaGroup(m: {
  mime: string;
  resourceType: string | null;
}): "image" | "audio" | "video" | "document" {
  if (m.mime.startsWith("image/")) return "image";
  if (m.mime.startsWith("audio/")) return "audio";
  if (m.mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Upload bytes to Cloudinary (optimised) and record a media row. Returns the
 * inserted row. The caller is responsible for quota + permission checks.
 */
export async function storeMedia(opts: {
  churchId: string;
  buffer: Buffer;
  mime: string;
  kind: MediaKind;
  originalName?: string;
  title?: string;
  uploadedBy?: string | null;
  /**
   * When this row should be swept away, or omitted to keep it for ever.
   *
   * Decided by the SERVER from the kind, never passed in from a browser — a
   * client-chosen retention is a client-chosen way to keep a file for ever.
   * See the upload route.
   */
  expiresAt?: Date | null;
}): Promise<Media> {
  if (!isCloudinaryConfigured())
    throw new Error("Cloudinary isn't configured.");

  const { resourceType, audio } = classifyMime(opts.mime);
  const asset = await uploadToCloudinary(opts.buffer, {
    resourceType,
    audio,
    // A receipt is squeezed harder than a photo. The kind carries that, so no
    // caller has to remember to ask for it.
    purpose: opts.kind === "receipt" ? "receipt" : undefined,
    folder: `flockinsight/${opts.churchId}`,
    filename: opts.originalName,
  });

  const [row] = await db
    .insert(media)
    .values({
      churchId: opts.churchId,
      kind: opts.kind,
      mime: opts.mime,
      size: asset.bytes,
      bytes: asset.bytes,
      provider: "cloudinary",
      publicId: asset.publicId,
      resourceType: asset.resourceType,
      url: asset.url,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
      title: opts.title || opts.originalName || null,
      originalName: opts.originalName || null,
      uploadedBy: opts.uploadedBy ?? undefined,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();
  return row;
}

/**
 * Delete a media row (and its Cloudinary asset, if any). Scoped to a church so
 * one tenant can't delete another's files. Returns false if not found.
 *
 * A contribution receipt is refused unless the caller says otherwise. The
 * library hides receipts on purpose — a deleted proof leaves a disputed payment
 * reading as though no receipt was ever attached, and nothing records that one
 * existed — but the delete itself used to take any id, so anyone with media
 * rights could post a receipt's id and erase it. Releasing a receipt belongs to
 * the contribution it proves, where the release is recorded.
 */
export async function deleteMedia(
  id: string,
  churchId: string,
  opts: { allowReceipt?: boolean } = {},
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1);
  if (!row || row.churchId !== churchId) return false;
  if (row.kind === "receipt" && !opts.allowReceipt) return false;

  if (row.provider === "cloudinary" && row.publicId) {
    const resourceType = (row.resourceType as ResourceType) || "image";
    const gone = await destroyFromCloudinary(row.publicId, resourceType);
    /*
     * The row still goes. A church must be able to free its quota while
     * Cloudinary is having a bad hour, and refusing the delete would leave it
     * stuck behind a full-storage wall it cannot clear.
     *
     * But the asset is still there, billing the platform, and once the row is
     * gone nothing else knows its public id. So it is written down where the
     * storage cron will try again — never just dropped.
     */
    if (!gone) await rememberOrphan(churchId, row.publicId, resourceType, "destroy refused");
  }

  /*
   * Local files are removed from disk too, or deleting a sermon frees nothing
   * and the church keeps paying quota for bytes nobody can reach. The file goes
   * BEFORE the row: an orphaned file is a tidy-up job, an orphaned row is a
   * broken page.
   */
  if (row.provider === "local" && row.storageKey) {
    const { removeFile } = await import("@/lib/media-store");
    await removeFile(row.storageKey);
  }

  await db.delete(media).where(eq(media.id, id));
  return true;
}

/** Note a Cloudinary asset that outlived its row, for the storage cron. */
export async function rememberOrphan(
  churchId: string | null,
  publicId: string,
  resourceType: ResourceType,
  reason: string,
): Promise<void> {
  console.error("[media] Cloudinary would not delete an asset; orphan recorded", {
    churchId,
    publicId,
    resourceType,
    reason,
  });
  await db
    .insert(mediaOrphan)
    .values({ churchId, publicId, resourceType, lastError: reason.slice(0, 300) })
    .onConflictDoNothing({ target: mediaOrphan.publicId });
}

/**
 * Try again to delete assets Cloudinary refused earlier.
 *
 * For the storage cron. Each entry is removed only when Cloudinary confirms
 * the asset is gone ("ok" or "not found"); a failure is counted and retried no
 * more than hourly, so one stubborn asset cannot use up every run.
 */
export async function retryMediaOrphans(
  limit = 50,
  now: Date = new Date(),
): Promise<{ tried: number; cleared: number }> {
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const rows = await db
    .select()
    .from(mediaOrphan)
    .where(or(isNull(mediaOrphan.lastTriedAt), lt(mediaOrphan.lastTriedAt, hourAgo)))
    .orderBy(asc(mediaOrphan.createdAt))
    .limit(limit);

  let cleared = 0;
  for (const r of rows) {
    const gone = await destroyFromCloudinary(r.publicId, r.resourceType as ResourceType);
    if (gone) {
      await db.delete(mediaOrphan).where(eq(mediaOrphan.id, r.id));
      cleared++;
    } else {
      await db
        .update(mediaOrphan)
        .set({
          attempts: sql`${mediaOrphan.attempts} + 1`,
          lastTriedAt: now,
          lastError: "destroy refused on retry",
        })
        .where(and(eq(mediaOrphan.id, r.id)));
    }
  }
  if (rows.length > 0)
    console.log(`[media] orphan retry: ${cleared} of ${rows.length} Cloudinary asset(s) cleared`);
  return { tried: rows.length, cleared };
}
