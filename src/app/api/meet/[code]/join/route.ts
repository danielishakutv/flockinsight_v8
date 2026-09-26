import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getSession } from "@/lib/session";
import { resolveIceConfig } from "@/lib/ice";
import {
  addMessage,
  evaluateAdmission,
  getMeetingByCode,
  joinMeeting,
  listMessages,
  postSignals,
  roster,
  signalCursor,
  standingInChurch,
  HEARTBEAT_MS,
} from "@/lib/meetings";
import { parseStage } from "@/lib/meetings-shared";
import {
  cleanDisplayName,
  clearRateLimit,
  clientContext,
  fail,
  json,
  rateLimit,
  readJson,
} from "@/lib/meeting-api";
import { audit, auditGuest } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  name?: unknown;
  passcode?: unknown;
  /** From ?h= on the host link — see the schema note on `meeting.hostKey`. */
  hostKey?: unknown;
  micOn?: unknown;
  cameraOn?: unknown;
  lowData?: unknown;
  /** This browser's own id — see the schema note on `meetingParticipant.deviceId`. */
  deviceId?: unknown;
};

/**
 * POST /api/meet/<code>/join — walk into a room.
 *
 * Returns everything the client needs to render the meeting in one response:
 * who it is, who else is here, what is on the stage, the chat so far, the ICE
 * servers, and the signalling cursor to start listening from. One round trip,
 * because the first thing anyone does on a weak connection is join.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const { ip, userAgent } = await clientContext();

  // Guard the code space itself, not just passcodes: without this, the join
  // endpoint is an oracle for which meeting codes exist.
  const probe = rateLimit(`join:${ip ?? "unknown"}`, 40, 60_000);
  if (!probe.ok)
    return fail("Too many attempts. Wait a moment and try again.", 429);

  const m = await getMeetingByCode(code);
  if (!m) return fail("We couldn't find that meeting.", 404, { code: "not-found" });

  const body = (await readJson<Body>(request)) ?? {};
  const session = await getSession();
  const userId = session?.user?.id ?? null;

  const standing = await standingInChurch(m.churchId, userId);
  const passcode = typeof body.passcode === "string" ? body.passcode : null;
  const hostKey = typeof body.hostKey === "string" ? body.hostKey : null;

  const verdict = await evaluateAdmission({
    meeting: m,
    userId,
    standing,
    passcode,
    hostKey,
  });
  if (!verdict.ok) {
    if (verdict.code === "passcode") {
      const gate = rateLimit(`passcode:${m.id}:${ip ?? "unknown"}`, 8, 10 * 60_000);
      if (!gate.ok)
        return fail(
          "Too many wrong passcodes. Try again in a few minutes.",
          429,
          { code: "rate-limited" },
        );
    }
    return fail(verdict.message, verdict.code === "not-found" ? 404 : 403, {
      code: verdict.code,
      title: m.title,
      churchId: m.churchId,
    });
  }
  clearRateLimit(`passcode:${m.id}:${ip ?? "unknown"}`);

  const displayName = cleanDisplayName(
    body.name || session?.user?.name,
    session?.user?.name || "Guest",
  );

  // What the controls start as. A meeting set to mute on entry still lets a
  // host arrive unmuted — they are the one who has to say "good morning".
  const isHost = verdict.role === "host" || verdict.role === "cohost";
  const lowData = body.lowData === true || (body.lowData !== false && m.lowDataDefault);
  const micOn = body.micOn === true && (isHost || !m.muteOnEntry);
  const cameraOn = body.cameraOn === true && !lowData && (isHost || !m.cameraOffOnEntry);

  const me = await joinMeeting({
    meetingId: m.id,
    churchId: m.churchId,
    displayName,
    role: verdict.role,
    admitted: verdict.admitted,
    userId,
    memberId: standing.memberId,
    // Bounded and shape-checked rather than trusted: it is written by the
    // browser and ends up in a WHERE clause on every join.
    deviceId:
      typeof body.deviceId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.deviceId)
        ? body.deviceId
        : null,
    micOn,
    cameraOn,
    lowData,
    userAgent,
    ip,
  });

  // Tell the room. A roster signal is the trigger for everyone already here to
  // work out that there is a new peer to call.
  //
  // A `bye` per replaced session goes first, so nobody ever renders this
  // device twice — not even for the second between the two signals.
  await postSignals(
    m.id,
    me.peerId,
    me.replaced.map((peerId) => ({
      toPeer: null,
      type: "bye" as const,
      payload: { peerId, reason: "replaced" },
    })),
  );
  await postSignals(m.id, me.peerId, [
    {
      type: verdict.admitted ? "roster" : "control",
      payload: verdict.admitted
        ? { reason: "join", peerId: me.peerId, name: displayName, role: verdict.role }
        : { action: "knock", peerId: me.peerId, name: displayName, participantId: me.participantId },
    },
  ]);

  if (verdict.admitted && m.allowChat) {
    await addMessage({
      meetingId: m.id,
      churchId: m.churchId,
      participantId: me.participantId,
      authorName: displayName,
      body: `${displayName} joined`,
      kind: "system",
    });
  }

  const [c] = await db
    .select({ name: church.name, logo: church.logo })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);

  const [people, cursor, messages] = await Promise.all([
    roster(m.id),
    signalCursor(m.id),
    m.allowChat ? listMessages(m.id, 200) : Promise.resolve([]),
  ]);

  const entry = {
    action: "meetings.meeting.join",
    summary: `${displayName} joined the meeting "${m.title}"`,
    targetType: "meeting",
    targetId: m.id,
    targetLabel: m.title,
    meta: {
      role: verdict.role,
      admitted: verdict.admitted,
      lowData,
      guest: !userId,
    },
  } as const;
  if (userId) await audit({ churchId: m.churchId, ...entry });
  else await auditGuest({ churchId: m.churchId, guestName: displayName, ...entry });

  return json({
    ok: true,
    meeting: {
      id: m.id,
      code: m.code,
      title: m.title,
      description: m.description,
      kind: m.kind,
      status: verdict.admitted ? "live" : m.status,
      allowChat: m.allowChat,
      allowReactions: m.allowReactions,
      allowScreenShare: m.allowScreenShare || isHost,
      allowRecording: m.allowRecording,
      maxParticipants: m.maxParticipants,
      lowDataDefault: m.lowDataDefault,
      churchName: c?.name ?? "",
      churchLogo: c?.logo ?? null,
    },
    me: {
      participantId: me.participantId,
      peerId: me.peerId,
      secret: me.secret,
      role: me.role,
      admitted: me.admitted,
      name: displayName,
      micOn,
      cameraOn,
      lowData,
      isStaff: standing.isStaff,
    },
    ice: await resolveIceConfig(`m-${m.code}`),
    roster: people,
    stage: parseStage(m.stage),
    slides: m.slides ?? [],
    messages: messages.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
    cursor,
    heartbeatMs: HEARTBEAT_MS,
  });
}
