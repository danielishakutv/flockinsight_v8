import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { storeMedia, type MediaKind, MEDIA_KINDS } from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hard ceiling per file (the church quota is the real limit; this just guards
// against absurd single uploads / request bodies).
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

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

// Which permission a given upload kind needs (owners always pass).
function permForKind(kind: MediaKind): string {
  switch (kind) {
    case "logo":
    case "cover":
    case "photo":
    case "event":
      return "settings.manage";
    case "member":
      return "members.manage";
    default:
      return "media.manage"; // sermon, file
  }
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

  if (!(await can(permForKind(kind))))
    return json({ ok: false, error: "You can't upload this." }, 403);

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
