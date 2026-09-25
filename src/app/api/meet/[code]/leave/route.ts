import {
  addMessage,
  getMeetingByCode,
  leaveMeeting,
  postSignals,
} from "@/lib/meetings";
import { json, requirePeer } from "@/lib/meeting-api";
import { audit, auditGuest } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/leave — say goodbye properly.
 *
 * Called on the way out, and also from `navigator.sendBeacon` when the tab is
 * closing. A beacon posts a Blob whose content type the browser controls and
 * cannot carry credentials or custom headers, so the body is read by hand
 * rather than through `request.json()`, and the peer's own secret inside it is
 * what authenticates the call.
 *
 * Presence would time out on its own within about forty seconds. This is what
 * makes leaving instant instead — a tile that lingers after someone has gone
 * is the thing people notice most about a bad meeting app.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  let body: { peer?: unknown; secret?: unknown } | null = null;
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  const m = await getMeetingByCode(code);
  // Nothing here is worth an error response: the tab is already closing and
  // nobody will ever read it.
  if (!m) return json({ ok: true });

  const peer = await requirePeer(m.id, body);
  if (!peer) return json({ ok: true });

  await leaveMeeting(peer.id);
  await postSignals(m.id, peer.peerId, [
    { toPeer: null, type: "bye", payload: { peerId: peer.peerId } },
  ]);

  if (m.allowChat) {
    await addMessage({
      meetingId: m.id,
      churchId: m.churchId,
      participantId: peer.id,
      authorName: peer.displayName,
      body: `${peer.displayName} left`,
      kind: "system",
    });
  }

  const entry = {
    action: "meetings.meeting.leave",
    summary: `${peer.displayName} left the meeting "${m.title}"`,
    targetType: "meeting",
    targetId: m.id,
    targetLabel: m.title,
  } as const;
  if (peer.userId) await audit({ churchId: m.churchId, ...entry });
  else
    await auditGuest({ churchId: m.churchId, guestName: peer.displayName, ...entry });

  return json({ ok: true });
}
