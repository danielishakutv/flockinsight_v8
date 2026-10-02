import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getMeetingByCode, authenticatePeer } from "@/lib/meetings";
import { isHostRole } from "@/lib/meetings-shared";
import {
  isCloudinaryConfigured,
  signDirectUpload,
  MAX_ASSET_BYTES,
} from "@/lib/cloudinary";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
import { fail, json } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording/sign — permission to upload, not the upload.
 *
 * The browser sends the recording to Cloudinary itself; this only says whether
 * it may, and signs the exact parameters it is allowed to use. The file never
 * touches our server, which is the entire point: Cloudflare rejects any body
 * over 100 MB with a 413 long before the origin sees it, and an hour of
 * meeting video is roughly three times that.
 *
 * Every reason to refuse is checked here, while refusing is still cheap — a
 * host should learn their quota is full before they wait out a ten-minute
 * upload, not after.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404);

  let body: {
    peer?: string;
    secret?: string;
    bytes?: number;
    mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return fail("We couldn't read that request.", 400);
  }

  const peer = await authenticatePeer(m.id, String(body.peer ?? ""), String(body.secret ?? ""));
  if (!peer) return fail("You've been signed out of this meeting.", 401);
  if (!isHostRole(peer.role)) return fail("Only the host can save a recording.", 403);
  if (!m.allowRecording) return fail("Recording is turned off for this meeting.", 403);

  if (!isCloudinaryConfigured())
    return fail(
      "Media storage isn't set up for this church yet, so the recording stays on your device.",
      503,
      { keepLocal: true },
    );

  const bytes = Math.max(0, Math.round(Number(body.bytes ?? 0)) || 0);
  const mode = body.mode === "audio" ? "audio" : "video";

  const [c] = await db
    .select({ storageExtraBytes: church.storageExtraBytes })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);

  /*
   * Too big to store at all, whatever the quota says. Refused here, before the
   * host waits out an upload that Cloudinary will reject on the final chunk —
   * and `keepLocal` so the recording stays in their browser's vault rather than
   * being treated as dealt with.
   */
  if (bytes > MAX_ASSET_BYTES)
    return fail(
      `This recording is ${formatBytes(bytes)} and the largest file we can store is ${formatBytes(MAX_ASSET_BYTES)}. It stays on your device — download it from the Unsaved recordings panel, and record in audio-only mode for long meetings.`,
      413,
      { keepLocal: true, limit: MAX_ASSET_BYTES },
    );

  const info = await getStorageInfo(m.churchId, c?.storageExtraBytes ?? 0);
  if (bytes > 0 && info.used + bytes > info.limit)
    return fail(
      `Not enough storage — this recording is ${formatBytes(bytes)} and you have ${formatBytes(info.free)} free. It stays on your device until you make room.`,
      413,
      { keepLocal: true, quota: { used: info.used, limit: info.limit } },
    );

  const ticket = signDirectUpload({
    folder: `flockinsight/${m.churchId}`,
    // Cloudinary stores audio under the video resource type; `audio` only
    // changes which incoming transformation is applied.
    resourceType: "video",
    audio: mode === "audio",
    uniqueUploadId: randomUUID().replace(/-/g, ""),
  });

  if (!ticket)
    return fail("Media storage isn't available right now.", 503, { keepLocal: true });

  return json({ ok: true, ticket });
}
