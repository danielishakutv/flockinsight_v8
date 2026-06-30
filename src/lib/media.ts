import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media, type Media } from "@/db/schema";
import {
  uploadToCloudinary,
  destroyFromCloudinary,
  isCloudinaryConfigured,
  type ResourceType,
} from "@/lib/cloudinary";

export type MediaKind =
  | "logo"
  | "cover"
  | "photo"
  | "member"
  | "event"
  | "devotional"
  | "sermon"
  | "file";

export const MEDIA_KINDS: MediaKind[] = [
  "logo",
  "cover",
  "photo",
  "member",
  "event",
  "devotional",
  "sermon",
  "file",
];

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
}): Promise<Media> {
  if (!isCloudinaryConfigured())
    throw new Error("Cloudinary isn't configured.");

  const { resourceType, audio } = classifyMime(opts.mime);
  const asset = await uploadToCloudinary(opts.buffer, {
    resourceType,
    audio,
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
    })
    .returning();
  return row;
}

/**
 * Delete a media row (and its Cloudinary asset, if any). Scoped to a church so
 * one tenant can't delete another's files. Returns false if not found.
 */
export async function deleteMedia(
  id: string,
  churchId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1);
  if (!row || row.churchId !== churchId) return false;

  if (row.provider === "cloudinary" && row.publicId) {
    await destroyFromCloudinary(
      row.publicId,
      (row.resourceType as ResourceType) || "image",
    );
  }
  await db.delete(media).where(eq(media.id, id));
  return true;
}
