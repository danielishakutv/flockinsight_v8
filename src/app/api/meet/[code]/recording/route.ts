import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import {
  completeRecording,
  getMeetingByCode,
  postSignals,
} from "@/lib/meetings";
import { isHostRole } from "@/lib/meetings-shared";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { storeMedia } from "@/lib/media";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
import { authenticatePeer } from "@/lib/meetings";
import { fail, json } from "@/lib/meeting-api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * A recording is one HTTP body, so it has to fit in one. Longer meetings are
 * recorded in audio mode (roughly 1 MB a minute against video's 15–30) or
 * saved to the host's own device, which the room always offers regardless.
 */
const MAX_BYTES = 300 * 1024 * 1024;

/**
 * POST /api/meet/<code>/recording — hand up a finished recording.
 *
 * The capture happens entirely in the host's browser: a canvas composite of
 * the stage and the mixed audio of everyone in the room. The server sees the
 * result, never the stream. That is what makes recording free to run — and it
 * also means a host who loses their connection mid-meeting still has the file,
 * because the "Download" button in the room does not involve us at all.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("We couldn't read the upload.", 400);
  }

  const peerId = String(form.get("peer") ?? "");
  const secret = String(form.get("secret") ?? "");
  const peer = await authenticatePeer(m.id, peerId, secret);
  if (!peer) return fail("You've been signed out of this meeting.", 401);
  if (!isHostRole(peer.role)) return fail("Only the host can save a recording.", 403);
  if (!m.allowRecording) return fail("Recording is turned off for this meeting.", 403);

  const recordingId = String(form.get("recordingId") ?? "");
  const durationSec = Math.max(0, Math.round(Number(form.get("durationSec") ?? 0)) || 0);
  const mode = String(form.get("mode") ?? "video") === "audio" ? "audio" : "video";

  const file = form.get("file");
  if (!(file instanceof File)) return fail("No recording was attached.", 400);

  const failUpload = async (message: string, status: number, extra?: Record<string, unknown>) => {
    if (recordingId)
      await completeRecording({
        id: recordingId,
        churchId: m.churchId,
        status: "local-only",
        durationSec,
        error: message,
      });
    return fail(message, status, { ...extra, keepLocal: true });
  };

  if (file.size > MAX_BYTES)
    return failUpload(
      `That recording is ${formatBytes(file.size)} — too big to store here. It's saved on your device; upload it to the media library from there if you need it kept.`,
      413,
    );

  if (!isCloudinaryConfigured())
    return failUpload(
      "Media storage isn't set up for this church yet, so the recording stays on your device.",
      503,
    );

  const [c] = await db
    .select({ storageExtraBytes: church.storageExtraBytes })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);

  const info = await getStorageInfo(m.churchId, c?.storageExtraBytes ?? 0);
  if (info.used + file.size > info.limit)
    return failUpload(
      `Not enough storage — this recording is ${formatBytes(file.size)} and you have ${formatBytes(info.free)} free. It's saved on your device.`,
      413,
      { quota: { used: info.used, limit: info.limit } },
    );

  const title = `${m.title} — recording`;
  try {
    const row = await storeMedia({
      churchId: m.churchId,
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type || (mode === "audio" ? "audio/webm" : "video/webm"),
      kind: "sermon",
      originalName: `${m.code}-recording.${file.type.includes("mp4") ? "mp4" : "webm"}`,
      title,
      uploadedBy: peer.userId,
    });

    if (recordingId)
      await completeRecording({
        id: recordingId,
        churchId: m.churchId,
        mediaId: row.id,
        url: row.url,
        bytes: row.bytes,
        durationSec,
        status: "ready",
      });

    await postSignals(m.id, peer.peerId, [
      { toPeer: null, type: "recording", payload: { state: "saved" } },
    ]);

    await audit({
      churchId: m.churchId,
      action: "meetings.recording.update",
      summary: `Saved a ${mode} recording of "${m.title}" to the media library`,
      targetType: "meeting",
      targetId: m.id,
      targetLabel: m.title,
      meta: { mode, bytes: row.bytes, durationSec, mediaId: row.id },
      severity: "notice",
    });

    return json({ ok: true, mediaId: row.id, url: row.url, bytes: row.bytes });
  } catch (e) {
    console.error("[meet/recording] upload failed", e);
    return failUpload(
      "We couldn't save the recording to the library. It's still on your device.",
      500,
    );
  }
}
