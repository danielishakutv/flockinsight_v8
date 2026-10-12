import { churchForApi, refusalResponse } from "@/lib/api-church";
import { randomUUID } from "crypto";
import {
  isCloudinaryConfigured,
  signDirectUpload,
  MAX_ASSET_BYTES,
} from "@/lib/cloudinary";
import {
  canUploadKind,
  classifyMime,
  refuseUploadKind,
  MEDIA_KINDS,
  type MediaKind,
} from "@/lib/media";
import { LIBRARY_FORBIDDEN } from "@/lib/media-upload-rules";
import { issueUploadTicket } from "@/lib/media-upload-tickets";
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
  const who = await churchForApi();
  if (!who.ok) return refusalResponse(who);
  const { church, user } = who;

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

  if (!(await canUploadKind(kind)))
    return json({ ok: false, code: "forbidden", error: LIBRARY_FORBIDDEN }, 403);

  if (church.status === "suspended")
    return json({ ok: false, error: "This church's account is paused." }, 403);

  // The sermon library is Pro's; the same answer every upload route gives.
  const gate = await refuseUploadKind(kind);
  if (gate) return json(gate, 403);

  /*
   * A size is required. The quota check below used to be skipped when it was
   * zero or missing, so `{bytes: 0}` bought a ticket at a full quota. The real
   * client always sends the file's size; nothing honest sends 0.
   */
  if (bytes <= 0)
    return json({ ok: false, error: "Say how big the file is before uploading it." }, 400);

  /*
   * The per-file ceiling, checked before a single byte moves.
   *
   * Cloudinary refuses an oversized asset on the LAST chunk — so without this a
   * 266 MB video uploads for ten minutes and is then thrown away, which is the
   * most dispiriting way software can waste somebody's evening. One second and
   * a sentence that names the real number is better than ten minutes and a
   * shrug.
   */
  if (bytes > MAX_ASSET_BYTES)
    return json(
      {
        ok: false,
        error: `This file is ${formatBytes(bytes)}, and the largest single file we can store is ${formatBytes(MAX_ASSET_BYTES)}. Nothing was uploaded. Split it, shorten it, or compress it first.`,
        limit: MAX_ASSET_BYTES,
      },
      413,
    );

  const { resourceType, audio } = classifyMime(mime);

  /*
   * One ticket, one asset. The public id is chosen here and signed (with
   * overwrite=false), so the ticket cannot be reused for a second file or to
   * replace the first — and /complete re-checks the quota against the size
   * Cloudinary actually stored, because the size here is only the browser's
   * word.
   *
   * And the ticket is WRITTEN DOWN before it is handed out. An upload that
   * never reaches /complete used to be counted against nobody, and tickets
   * could be asked for without limit. Now its declared size is reserved while
   * it is open, a church may hold only a few at once, and the storage cron
   * destroys the asset of any ticket nobody completed. See `issueUploadTicket`.
   */
  const name = randomUUID();
  const folder = `flockinsight/${church.id}`;
  const verdict = await issueUploadTicket({
    churchId: church.id,
    storageExtraBytes: church.storageExtraBytes,
    publicId: `${folder}/${name}`,
    resourceType,
    bytes,
    userId: user.id,
  });
  if (!verdict.ok)
    return json({ ok: false, code: verdict.code, error: verdict.error }, verdict.status);

  const ticket = signDirectUpload({
    folder,
    resourceType,
    audio,
    uniqueUploadId: randomUUID(),
    publicId: name,
  });
  if (!ticket)
    return json({ ok: false, error: "Media uploads aren't set up yet." }, 503);

  return json({ ok: true, ticket, resourceType });
}
