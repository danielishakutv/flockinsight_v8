import { db } from "@/db";
import { media } from "@/db/schema";
import {
  authenticatePeer,
  completeRecording,
  getMeetingByCode,
  postSignals,
} from "@/lib/meetings";
import { isHostRole } from "@/lib/meetings-shared";
import { fetchCloudinaryAsset } from "@/lib/cloudinary";
import { fail, json } from "@/lib/meeting-api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording/complete — the file is up; record it.
 *
 * A small JSON body naming what the browser uploaded. The asset is then read
 * back from Cloudinary rather than trusted: the size becomes a church's
 * storage accounting and the url becomes a media row people play, so a forged
 * response must not be able to inflate a quota or point at somebody else's
 * asset.
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
    publicId?: string;
    recordingId?: string | null;
    durationSec?: number;
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

  const publicId = String(body.publicId ?? "");
  if (!publicId) return fail("No uploaded file was named.", 400);

  /*
   * The folder is the church's own. Cloudinary would happily describe any
   * asset in the account, so without this check one church's host could attach
   * another church's recording to their own media library.
   */
  if (!publicId.startsWith(`flockinsight/${m.churchId}/`)) {
    return fail("That file doesn't belong to this church.", 403);
  }

  const asset = await fetchCloudinaryAsset(publicId, "video");
  if (!asset)
    return fail(
      "The upload finished but we couldn't confirm it. Your copy is still on this device — try saving again.",
      502,
      { keepLocal: true },
    );

  const mode = body.mode === "audio" ? "audio" : "video";
  const durationSec =
    asset.durationSec ?? Math.max(0, Math.round(Number(body.durationSec ?? 0)) || 0);
  const recordingId = body.recordingId ? String(body.recordingId) : "";

  const [row] = await db
    .insert(media)
    .values({
      churchId: m.churchId,
      kind: "sermon",
      mime: mode === "audio" ? "audio/webm" : "video/webm",
      size: asset.bytes,
      bytes: asset.bytes,
      provider: "cloudinary",
      publicId: asset.publicId,
      resourceType: asset.resourceType,
      url: asset.url,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      durationSec,
      title: `${m.title} — recording`,
      originalName: `${m.code}-recording.${asset.format ?? "webm"}`,
      uploadedBy: peer.userId ?? undefined,
    })
    .returning();

  if (recordingId)
    await completeRecording({
      id: recordingId,
      churchId: m.churchId,
      mediaId: row.id,
      url: row.url,
      bytes: asset.bytes,
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
    meta: { mode, bytes: asset.bytes, durationSec, mediaId: row.id, direct: true },
    severity: "notice",
  });

  return json({ ok: true, mediaId: row.id, url: row.url, bytes: asset.bytes });
}
