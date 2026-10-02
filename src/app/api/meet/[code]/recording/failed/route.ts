import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingRecording } from "@/db/schema";
import { authenticatePeer, getMeetingByCode } from "@/lib/meetings";
import { isHostRole } from "@/lib/meetings-shared";
import { fail, json } from "@/lib/meeting-api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording/failed — say that a recording did NOT save.
 *
 * This endpoint exists because of the worst bug this product can have: eleven
 * recordings in production sitting at status "uploading" with zero bytes, zero
 * duration and a null error — forever. Every one of them was a host who stopped
 * recording, saw nothing obviously wrong, and believed they had a recording.
 *
 * The cause was not the upload. It was that nothing on the failing path ever
 * told the server. The browser handled its own errors perfectly well — a toast,
 * a note in the local vault — and then the row it had created at the start of
 * the recording stayed "uploading" for the rest of time. A status that can only
 * ever move forwards is not a status, it is a hope.
 *
 * So every failing path now reports here, and the row says what went wrong in
 * the words the host saw. The file itself is untouched and still in this
 * browser's vault: this records the failure, it does not give up on the
 * recording.
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
    recordingId?: string | null;
    reason?: string;
    /** "upload" | "empty" | "cancelled" | "capture" — where it broke. */
    stage?: string;
  };
  try {
    body = await request.json();
  } catch {
    return fail("We couldn't read that request.", 400);
  }

  const peer = await authenticatePeer(
    m.id,
    String(body.peer ?? ""),
    String(body.secret ?? ""),
  );
  if (!peer) return fail("You've been signed out of this meeting.", 401);
  if (!isHostRole(peer.role)) return fail("Only the host can do that.", 403);

  const recordingId = body.recordingId ? String(body.recordingId) : "";
  if (!recordingId) return fail("No recording was named.", 400);

  const stage = String(body.stage ?? "upload").slice(0, 20);
  const reason = String(body.reason ?? "").trim().slice(0, 500) || "The upload did not finish.";

  /*
   * Scoped to this church AND left alone if it already succeeded.
   *
   * The second part matters: a slow "complete" and a retry's failure report can
   * arrive in either order, and marking a recording that is safely in the
   * library as failed would be a lie in the more alarming direction. Only a row
   * still claiming to be uploading is moved.
   */
  const [row] = await db
    .update(meetingRecording)
    .set({ status: "failed", error: `${stage}: ${reason}` })
    .where(
      and(
        eq(meetingRecording.id, recordingId),
        eq(meetingRecording.churchId, m.churchId),
        eq(meetingRecording.status, "uploading"),
      ),
    )
    .returning({ id: meetingRecording.id, mode: meetingRecording.mode });

  if (!row) return json({ ok: true, changed: false });

  /*
   * Logged where somebody will see it. A recording that did not save is not
   * routine housekeeping — it is the thing the host will ask about on Monday,
   * and "warning" is what puts it in front of them in the activity log.
   */
  await audit({
    churchId: m.churchId,
    action: "meetings.recording.failed",
    summary: `A ${row.mode} recording of "${m.title}" did not save — ${reason}`,
    targetType: "meeting",
    targetId: m.id,
    targetLabel: m.title,
    meta: { recordingId, stage, reason },
    severity: "warning",
  });

  // Loud on the server too, so the next time this happens there is a line to
  // find rather than silence. This is the signal that was missing entirely.
  console.error(
    `[meetings] recording ${recordingId} failed at "${stage}" for church ${m.churchId}: ${reason}`,
  );

  return json({ ok: true, changed: true });
}
