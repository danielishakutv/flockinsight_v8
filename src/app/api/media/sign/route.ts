import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { randomUUID } from "crypto";
import { isCloudinaryConfigured, signDirectUpload } from "@/lib/cloudinary";
import { classifyMime, permForKind, MEDIA_KINDS, type MediaKind } from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";

export const runtime = "nodejs";

/**
 * POST /api/media/sign — permission to upload a big file, not the upload.
 *
 * The media library used to post every file through this origin, which means
 * through Cloudflare, which rejects any request body over 100 MB with a 413
 * before our server ever hears about it. That is the same wall meeting
 * recordings hit, and it is why somebody who downloaded a recording and tried
 * to upload it by hand watched it fail for no visible reason: the refusal
 * happens at the edge, so there is nothing in our logs and nothing useful to
 * show them.
 *
 * Recordings already route around it by uploading straight to Cloudinary in
 * chunks. This gives the media library the same road. Every reason to refuse is
 * checked here, while refusing is still cheap — nobody should wait out a
 * ten-minute upload to be told their quota was full before it started.
 */
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const { church } = await requireChurch();

  if (!isCloudinaryConfigured())
    return json(
      { ok: false, error: "Media uploads aren't set up on this site yet." },
      503,
    );

  let body: { kind?: string; bytes?: number; mime?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read that request." }, 400);
  }

  const kind: MediaKind = MEDIA_KINDS.includes(body.kind as MediaKind)
    ? (body.kind as MediaKind)
    : "file";
  const mime = String(body.mime ?? "");
  const bytes = Math.max(0, Math.round(Number(body.bytes ?? 0)) || 0);

  if (!(await can(permForKind(kind))))
    return json({ ok: false, error: "You can't upload this." }, 403);

  if (church.status === "suspended")
    return json({ ok: false, error: "This church's account is paused." }, 403);

  const info = await getStorageInfo(church.id, church.storageExtraBytes);
  if (bytes > 0 && info.used + bytes > info.limit)
    return json(
      {
        ok: false,
        error: `Not enough storage — this file is ${formatBytes(bytes)} and you have ${formatBytes(info.free)} free. Free up space or upgrade your storage.`,
        quota: { used: info.used, limit: info.limit },
      },
      413,
    );

  const { resourceType, audio } = classifyMime(mime);

  const ticket = signDirectUpload({
    folder: `flockinsight/${church.id}`,
    resourceType,
    audio,
    uniqueUploadId: randomUUID(),
  });
  if (!ticket)
    return json({ ok: false, error: "Media uploads aren't set up yet." }, 503);

  return json({ ok: true, ticket, resourceType });
}
