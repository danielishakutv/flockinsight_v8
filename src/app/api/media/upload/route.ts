import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { can } from "@/lib/permissions";
import { isCloudinaryConfigured, MAX_ASSET_BYTES } from "@/lib/cloudinary";
import {
  AVATAR_KIND,
  permForKind,
  storeMedia,
  type MediaKind,
  MEDIA_KINDS,
} from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * Hard ceiling per file.
 *
 * Two different limits happen to meet near the same number and both are real:
 * Cloudflare rejects a request body over 100 MB before this route is reached at
 * all, and Cloudinary will not store an asset above MAX_ASSET_BYTES. Anything
 * large should be going through /api/media/sign and straight to Cloudinary
 * instead (see upload-provider.tsx); this path is for small files.
 */
const MAX_BYTES = Math.min(MAX_ASSET_BYTES, 100 * 1024 * 1024);

const DOC_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/rtf",
]);

function isAllowedMime(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    DOC_MIME.has(mime)
  );
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/media/upload  (multipart: file, kind, title?)  -> { ok, ... }
export async function POST(request: Request) {
  const { church, user } = await requireChurch();

  if (!isCloudinaryConfigured())
    return json(
      { ok: false, error: "Media uploads aren't configured yet. Contact support." },
      503,
    );

  let file: File | null = null;
  let kind: MediaKind = "file";
  let title = "";
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const k = form.get("kind");
    if (typeof k === "string" && MEDIA_KINDS.includes(k as MediaKind))
      kind = k as MediaKind;
    const t = form.get("title");
    if (typeof t === "string") title = t.trim().slice(0, 200);
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }

  if (!file) return json({ ok: false, error: "No file uploaded." }, 400);

  /*
   * Your own face needs no permission over the church.
   *
   * Everything else here still applies — signed in, a real church, the mime
   * whitelist, the size cap, the storage quota — but requiring
   * settings.manage to change a profile picture would mean the people most
   * likely to have one (a member given a staff login) are the ones who cannot.
   */
  if (kind !== AVATAR_KIND && !(await can(permForKind(kind))))
    return json({ ok: false, error: "You can't upload this." }, 403);

  /*
   * The sermon library is the Pro part of media, not media itself.
   *
   * Every plan buys storage ("100 MB of storage for photos, documents and
   * media"), and gating uploads wholesale would break a logo, a cover image, a
   * member photo and a devotional picture for every church below Pro — which is
   * most of what is actually in there. What Pro sells is keeping SERMONS: audio,
   * video and slides with their own watch pages. So the gate is on that kind.
   */
  if (kind === "sermon") {
    const gate = await refuseWithoutFeature("mediaLibrary");
    if (gate) return json(gate, 403);
  }

  if (!isAllowedMime(file.type))
    return json({ ok: false, error: "That file type isn't supported." }, 400);
  if (file.size > MAX_BYTES)
    return json(
      { ok: false, error: `Files must be under ${formatBytes(MAX_BYTES)}.` },
      400,
    );

  // Quota check against the *incoming* size (the stored, optimised size is
  // usually smaller, so this errs on the safe side).
  const info = await getStorageInfo(church.id, church.storageExtraBytes);
  if (info.used + file.size > info.limit) {
    return json(
      {
        ok: false,
        error: `Not enough storage. You've used ${formatBytes(info.used)} of ${formatBytes(info.limit)}. Free up space or upgrade your storage.`,
        quota: { used: info.used, limit: info.limit },
      },
      413,
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let row;
  try {
    row = await storeMedia({
      churchId: church.id,
      buffer: buf,
      mime: file.type,
      kind,
      originalName: file.name,
      title: title || undefined,
      uploadedBy: user.id,
    });
  } catch (e) {
    console.error("[media/upload] failed", e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Upload failed." },
      500,
    );
  }

  return json({
    ok: true,
    id: row.id,
    link: `/media/${row.id}`,
    url: row.url,
    bytes: row.bytes,
    kind: row.kind,
    mime: row.mime,
    title: row.title,
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    createdAt: row.createdAt,
  });
}
