import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  meeting,
  meetingMessage,
  meetingParticipant,
  meetingRecording,
  meetingSignal,
  member,
  role,
  staff,
  user,
  type Meeting,
} from "@/db/schema";
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
} from "@/lib/permissions-catalog";
import {
  generateMeetingCode,
  parseStage,
  type MeetingRole,
  type RosterEntry,
  type SignalEnvelope,
  type SignalType,
  type Stage,
} from "@/lib/meetings-shared";

/* ============================================================
 * Presence
 *
 * A browser tab that is closed, crashes, or drives into a tunnel never tells
 * us it has gone. So presence is a heartbeat, not an event: a participant is
 * in the room while their row is still beating, and out of it when it stops.
 * ========================================================== */

/** How often a client is asked to beat. */
export const HEARTBEAT_MS = 5000;
/**
 * Silence longer than this and the row is treated as gone.
 *
 * This number has to be comfortably LARGER than the long-poll hold in
 * /api/meet/[code]/sync. A listening peer touches its row when the request
 * starts and again when the hold ends, so the widest gap between beats is one
 * hold. Set the timeout anywhere near that and other peers would watch each
 * other flicker out of the roster and back every few seconds — and every
 * flicker tears down a working peer connection and rebuilds it, which reads as
 * the video dropping on a perfectly good link.
 *
 * Leaving is instant anyway: a departing tab posts a `bye`, and a tab that
 * crashed is swept by this timeout and then by the housekeeping cron.
 */
export const PRESENCE_TIMEOUT_MS = 30_000;

function liveCutoff(): Date {
  return new Date(Date.now() - PRESENCE_TIMEOUT_MS);
}

/* ============================================================
 * Lookups
 * ========================================================== */

export async function getMeetingByCode(code: string): Promise<Meeting | null> {
  const [row] = await db
    .select()
    .from(meeting)
    .where(eq(meeting.code, code))
    .limit(1);
  return row ?? null;
}

/** Scoped to a church, so an id from one tenant cannot open another's room. */
export async function getMeeting(
  id: string,
  churchId: string,
): Promise<Meeting | null> {
  const [row] = await db
    .select()
    .from(meeting)
    .where(and(eq(meeting.id, id), eq(meeting.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

export type MeetingListRow = {
  id: string;
  code: string;
  title: string;
  kind: string;
  status: string;
  scheduledFor: Date | null;
  durationMin: number;
  startedAt: Date | null;
  endedAt: Date | null;
  access: string;
  hostName: string | null;
  liveCount: number;
  totalJoins: number;
  peakParticipants: number;
  recordings: number;
};

/**
 * Every meeting for a church, with its live headcount.
 *
 * The counts are grouped aggregates joined in JS rather than correlated
 * subqueries — a raw `sql` subquery in a join-less select loses its table
 * qualifier and silently counts zero (see AGENTS.md, and sql-safety.test.ts,
 * which fails the build on the shape).
 */
export async function listMeetings(
  churchId: string,
  opts: { limit?: number } = {},
): Promise<MeetingListRow[]> {
  const rows = await db
    .select({
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      kind: meeting.kind,
      status: meeting.status,
      scheduledFor: meeting.scheduledFor,
      durationMin: meeting.durationMin,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      access: meeting.access,
      totalJoins: meeting.totalJoins,
      peakParticipants: meeting.peakParticipants,
    })
    .from(meeting)
    .where(eq(meeting.churchId, churchId))
    .orderBy(desc(sql`coalesce(${meeting.startedAt}, ${meeting.scheduledFor}, ${meeting.createdAt})`))
    .limit(opts.limit ?? 200);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [live, recs, hosts] = await Promise.all([
    db
      .select({
        meetingId: meetingParticipant.meetingId,
        n: sql<number>`count(*)::int`,
      })
      .from(meetingParticipant)
      .where(
        and(
          inArray(meetingParticipant.meetingId, ids),
          isNull(meetingParticipant.leftAt),
          gte(meetingParticipant.lastSeenAt, liveCutoff()),
        ),
      )
      .groupBy(meetingParticipant.meetingId),
    db
      .select({
        meetingId: meetingRecording.meetingId,
        n: sql<number>`count(*)::int`,
      })
      .from(meetingRecording)
      .where(inArray(meetingRecording.meetingId, ids))
      .groupBy(meetingRecording.meetingId),
    db
      .select({ id: meeting.id, hostName: user.name })
      .from(meeting)
      .leftJoin(user, eq(user.id, meeting.hostUserId))
      .where(inArray(meeting.id, ids)),
  ]);

  const liveBy = new Map(live.map((r) => [r.meetingId, r.n]));
  const recBy = new Map(recs.map((r) => [r.meetingId, r.n]));
  const hostBy = new Map(hosts.map((r) => [r.id, r.hostName]));

  return rows.map((r) => ({
    ...r,
    hostName: hostBy.get(r.id) ?? null,
    liveCount: liveBy.get(r.id) ?? 0,
    recordings: recBy.get(r.id) ?? 0,
  }));
}

export type MeetingOverview = {
  upcoming: number;
  live: number;
  heldThisMonth: number;
  recordings: number;
};

export async function meetingsOverview(churchId: string): Promise<MeetingOverview> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [counts, recs] = await Promise.all([
    db
      .select({ status: meeting.status, n: sql<number>`count(*)::int` })
      .from(meeting)
      .where(eq(meeting.churchId, churchId))
      .groupBy(meeting.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(meetingRecording)
      .where(eq(meetingRecording.churchId, churchId)),
  ]);

  const [held] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(meeting)
    .where(
      and(
        eq(meeting.churchId, churchId),
        eq(meeting.status, "ended"),
        gte(meeting.startedAt, monthStart),
      ),
    );

  const by = new Map(counts.map((c) => [c.status, c.n]));
  return {
    upcoming: by.get("scheduled") ?? 0,
    live: by.get("live") ?? 0,
    heldThisMonth: held?.n ?? 0,
    recordings: recs[0]?.n ?? 0,
  };
}

/* ============================================================
 * Creating
 * ========================================================== */

/**
 * Allocate a code nobody else holds.
 *
 * The alphabet gives 23^10 combinations, so a clash is vanishingly unlikely —
 * but "vanishingly" is not "never", and a duplicate here would send one
 * church's congregation into another church's meeting. The unique index is the
 * real guarantee; this loop just avoids surfacing its error.
 */
export async function allocateMeetingCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateMeetingCode();
    const [taken] = await db
      .select({ id: meeting.id })
      .from(meeting)
      .where(eq(meeting.code, code))
      .limit(1);
    if (!taken) return code;
  }
  // Eight collisions in a row is not chance — fall back to something that
  // cannot collide rather than looping forever.
  return `x${randomUUID().replace(/-/g, "").slice(0, 11)}`;
}

/**
 * A key for the host link. Long and random: it is the whole of the proof, so
 * it has to be unguessable, and it is never shown beside the ordinary link.
 */
export function generateHostKey(): string {
  return randomBytes(18).toString("base64url");
}

/* ============================================================
 * Joining and presence
 * ========================================================== */

export type JoinResult = {
  participantId: string;
  peerId: string;
  secret: string;
  role: MeetingRole;
  admitted: boolean;
};

/**
 * Put someone in the room (or in the lobby).
 *
 * The returned `secret` is the only thing that proves, on every later request,
 * that the caller is this peer. It is minted here, handed to that one browser
 * tab, and never shown in a roster.
 */
export async function joinMeeting(opts: {
  meetingId: string;
  churchId: string;
  displayName: string;
  role: MeetingRole;
  admitted: boolean;
  userId?: string | null;
  memberId?: string | null;
  micOn: boolean;
  cameraOn: boolean;
  lowData: boolean;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<JoinResult> {
  const peerId = randomUUID();
  const secret = randomBytes(24).toString("base64url");

  const [row] = await db
    .insert(meetingParticipant)
    .values({
      meetingId: opts.meetingId,
      churchId: opts.churchId,
      peerId,
      secret,
      userId: opts.userId ?? null,
      memberId: opts.memberId ?? null,
      displayName: opts.displayName.slice(0, 80),
      role: opts.role,
      admitted: opts.admitted,
      micOn: opts.micOn,
      cameraOn: opts.cameraOn,
      lowData: opts.lowData,
      userAgent: opts.userAgent?.slice(0, 400) ?? null,
      ip: opts.ip ?? null,
    })
    .returning({ id: meetingParticipant.id });

  // A meeting becomes live the moment the first person is actually in it.
  if (opts.admitted) {
    await db
      .update(meeting)
      .set({
        status: "live",
        startedAt: sql`coalesce(${meeting.startedAt}, now())`,
        totalJoins: sql`${meeting.totalJoins} + 1`,
      })
      .where(and(eq(meeting.id, opts.meetingId), inArray(meeting.status, ["scheduled", "live"])));
    await refreshPeak(opts.meetingId);
  }

  return { participantId: row.id, peerId, secret, role: opts.role, admitted: opts.admitted };
}

/**
 * The authenticated handle on a participant. Everything a client posts goes
 * through here first.
 */
export type PeerIdentity = {
  id: string;
  meetingId: string;
  churchId: string;
  peerId: string;
  displayName: string;
  role: MeetingRole;
  admitted: boolean;
  userId: string | null;
};

/**
 * Verify a peer's secret in constant time.
 *
 * A plain `===` on a secret leaks its prefix through timing. That is a thin
 * attack against a meeting room, but the fix is one function call and the
 * alternative is explaining why we did the careless thing.
 */
export async function authenticatePeer(
  meetingId: string,
  peerId: string,
  secret: string,
): Promise<PeerIdentity | null> {
  if (!peerId || !secret) return null;
  const [row] = await db
    .select({
      id: meetingParticipant.id,
      meetingId: meetingParticipant.meetingId,
      churchId: meetingParticipant.churchId,
      peerId: meetingParticipant.peerId,
      displayName: meetingParticipant.displayName,
      role: meetingParticipant.role,
      admitted: meetingParticipant.admitted,
      removed: meetingParticipant.removed,
      userId: meetingParticipant.userId,
      secret: meetingParticipant.secret,
    })
    .from(meetingParticipant)
    .where(
      and(eq(meetingParticipant.meetingId, meetingId), eq(meetingParticipant.peerId, peerId)),
    )
    .limit(1);

  if (!row || row.removed) return null;

  const a = Buffer.from(row.secret);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    id: row.id,
    meetingId: row.meetingId,
    churchId: row.churchId,
    peerId: row.peerId,
    displayName: row.displayName,
    role: row.role,
    admitted: row.admitted,
    userId: row.userId,
  };
}

/** Keep a row beating, and record whatever the client's controls now say. */
export async function heartbeat(
  participantId: string,
  state?: Partial<{
    micOn: boolean;
    cameraOn: boolean;
    sharing: boolean;
    handRaised: boolean;
    lowData: boolean;
    quality: "good" | "fair" | "poor" | "lost";
  }>,
): Promise<void> {
  await db
    .update(meetingParticipant)
    .set({ lastSeenAt: new Date(), ...(state ?? {}) })
    .where(eq(meetingParticipant.id, participantId));
}

/** Mark someone gone, and store how long they were there. */
export async function leaveMeeting(participantId: string): Promise<void> {
  await db
    .update(meetingParticipant)
    .set({
      leftAt: new Date(),
      lastSeenAt: new Date(),
      micOn: false,
      cameraOn: false,
      sharing: false,
      handRaised: false,
      durationSec: sql`greatest(0, extract(epoch from (now() - ${meetingParticipant.joinedAt}))::int)`,
    })
    .where(and(eq(meetingParticipant.id, participantId), isNull(meetingParticipant.leftAt)));
}

/**
 * One person in a room, by the id the room knows them as.
 *
 * Unauthenticated on purpose: this answers "is this peer in this meeting and
 * what are they called", which is what a host needs before pointing the whole
 * room at somebody. It never returns the secret.
 */
export async function participantByPeerId(
  meetingId: string,
  peerId: string,
): Promise<{ id: string; displayName: string; role: MeetingRole } | null> {
  const [row] = await db
    .select({
      id: meetingParticipant.id,
      displayName: meetingParticipant.displayName,
      role: meetingParticipant.role,
      removed: meetingParticipant.removed,
      leftAt: meetingParticipant.leftAt,
    })
    .from(meetingParticipant)
    .where(
      and(
        eq(meetingParticipant.meetingId, meetingId),
        eq(meetingParticipant.peerId, peerId),
      ),
    )
    .limit(1);

  if (!row || row.removed || row.leftAt) return null;
  return { id: row.id, displayName: row.displayName, role: row.role as MeetingRole };
}

/**
 * Put one person on the main screen for the whole room, or clear it.
 *
 * `null` clears. Nothing here checks who is asking — the route does that, as
 * it does for every other thing that changes what a room is looking at.
 */
export async function setSpotlight(
  meetingId: string,
  peerId: string | null,
): Promise<void> {
  await db
    .update(meeting)
    .set({ spotlightPeerId: peerId })
    .where(eq(meeting.id, meetingId));
}

/**
 * Drop the spotlight if it is pointing at this person.
 *
 * Called on the way out. A spotlight on somebody who has gone is a black
 * rectangle where the preacher was, and nobody but the host can clear it —
 * so the room clears it itself. Scoped to the one peer, so somebody else
 * leaving never disturbs a spotlight that is working.
 */
export async function clearSpotlightFor(
  meetingId: string,
  peerId: string,
): Promise<void> {
  await db
    .update(meeting)
    .set({ spotlightPeerId: null })
    .where(and(eq(meeting.id, meetingId), eq(meeting.spotlightPeerId, peerId)));
}

/** Who is in the room right now. */
export async function roster(meetingId: string): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      id: meetingParticipant.id,
      peerId: meetingParticipant.peerId,
      name: meetingParticipant.displayName,
      role: meetingParticipant.role,
      micOn: meetingParticipant.micOn,
      cameraOn: meetingParticipant.cameraOn,
      sharing: meetingParticipant.sharing,
      handRaised: meetingParticipant.handRaised,
      lowData: meetingParticipant.lowData,
      quality: meetingParticipant.quality,
      admitted: meetingParticipant.admitted,
      joinedAt: meetingParticipant.joinedAt,
      userId: meetingParticipant.userId,
    })
    .from(meetingParticipant)
    .where(
      and(
        eq(meetingParticipant.meetingId, meetingId),
        isNull(meetingParticipant.leftAt),
        eq(meetingParticipant.removed, false),
        gte(meetingParticipant.lastSeenAt, liveCutoff()),
      ),
    )
    .orderBy(asc(meetingParticipant.joinedAt));

  return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
}

/**
 * Keep `peakParticipants` honest as people come and go.
 *
 * Counted with its own query and compared in SQL against a plain number — not
 * as a correlated subquery inside the UPDATE. Drizzle drops the table
 * qualifier on an interpolated column inside a raw template, so `where
 * meeting_id = ${meeting.id}` would render as `where meeting_id = "id"` and
 * bind BOTH names to meeting_participant: always true, count always the whole
 * table. Two separate queries cannot make that mistake. (AGENTS.md; see also
 * lib/sql-safety.test.ts.)
 */
async function refreshPeak(meetingId: string): Promise<void> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingParticipant)
    .where(
      and(
        eq(meetingParticipant.meetingId, meetingId),
        isNull(meetingParticipant.leftAt),
        eq(meetingParticipant.admitted, true),
        gte(meetingParticipant.lastSeenAt, liveCutoff()),
      ),
    );
  const live = row?.n ?? 0;
  if (live === 0) return;
  await db
    .update(meeting)
    .set({ peakParticipants: sql`greatest(${meeting.peakParticipants}, ${live})` })
    .where(eq(meeting.id, meetingId));
}

/* ============================================================
 * Signalling
 *
 * Postgres is the message bus. It sounds heavy for something as chatty as ICE
 * until you look at what it buys: PM2 runs this app in cluster mode, so an
 * in-process hub would only ever reach half the room, and two of the four
 * people in a meeting would silently never connect. The table is the one place
 * both workers can see.
 * ========================================================== */

export async function postSignals(
  meetingId: string,
  fromPeer: string,
  items: { toPeer?: string | null; type: SignalType; payload: Record<string, unknown> }[],
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(meetingSignal).values(
    items.slice(0, 60).map((s) => ({
      meetingId,
      fromPeer,
      toPeer: s.toPeer ?? null,
      type: s.type,
      payload: s.payload,
    })),
  );
  notifyRoom(meetingId);
}

/**
 * Everything addressed to me since my cursor.
 *
 * A peer never reads its own messages back: the sender already acted on them,
 * and echoing an offer to the person who made it is how a negotiation loop
 * starts.
 */
export async function readSignals(
  meetingId: string,
  peerId: string,
  since: number,
  limit = 200,
): Promise<SignalEnvelope[]> {
  const rows = await db
    .select({
      id: meetingSignal.id,
      fromPeer: meetingSignal.fromPeer,
      toPeer: meetingSignal.toPeer,
      type: meetingSignal.type,
      payload: meetingSignal.payload,
      createdAt: meetingSignal.createdAt,
    })
    .from(meetingSignal)
    .where(
      and(
        eq(meetingSignal.meetingId, meetingId),
        gt(meetingSignal.id, since),
        or(isNull(meetingSignal.toPeer), eq(meetingSignal.toPeer, peerId)),
      ),
    )
    .orderBy(asc(meetingSignal.id))
    .limit(limit);

  return rows
    .filter((r) => r.fromPeer !== peerId)
    .map((r) => ({
      id: Number(r.id),
      fromPeer: r.fromPeer,
      toPeer: r.toPeer,
      type: r.type as SignalType,
      payload: r.payload,
      at: r.createdAt.toISOString(),
    }));
}

/** The newest signal id, so a fresh listener starts from "now", not from 1. */
export async function signalCursor(meetingId: string): Promise<number> {
  const [row] = await db
    .select({ id: meetingSignal.id })
    .from(meetingSignal)
    .where(eq(meetingSignal.meetingId, meetingId))
    .orderBy(desc(meetingSignal.id))
    .limit(1);
  return Number(row?.id ?? 0);
}

/**
 * Sweep consumed signalling rows.
 *
 * Always age-scoped, and only ever this table: it is a transport buffer whose
 * rows are read within a second or two and are meaningless a minute later. The
 * record of what happened in a meeting is in meeting_participant,
 * meeting_message, meeting_recording and the audit log, and none of those is
 * ever swept.
 */
export async function pruneSignals(olderThanMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rows = await db
    .delete(meetingSignal)
    .where(lt(meetingSignal.createdAt, cutoff))
    .returning({ id: meetingSignal.id });
  return rows.length;
}

/* ============================================================
 * Waking listeners up
 *
 * Polling the table every second would work and would cost a query per
 * participant per second for the life of every meeting. LISTEN/NOTIFY lets a
 * write on one worker wake a reader on the other within milliseconds, so the
 * poll can drop to a slow safety net.
 *
 * Everything here is best-effort. If NOTIFY is unavailable the listeners fall
 * back to their timer and the meeting is a fraction less snappy — which is why
 * nothing in this section is ever allowed to throw.
 * ========================================================== */

const CHANNEL = "flockinsight_meeting";

type Waiter = { meetingId: string; wake: () => void };
const waiters = new Set<Waiter>();

const globalForBus = globalThis as unknown as {
  meetingBusReady?: boolean;
  meetingBusClient?: import("pg").Client;
};

async function ensureBus(): Promise<void> {
  if (globalForBus.meetingBusReady) return;
  globalForBus.meetingBusReady = true;
  try {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", (e) => {
      console.error("[meetings] notify client error", e);
      globalForBus.meetingBusReady = false;
      globalForBus.meetingBusClient = undefined;
    });
    client.on("notification", (msg) => {
      const id = msg.payload;
      if (!id) return;
      for (const w of waiters) if (w.meetingId === id) w.wake();
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    globalForBus.meetingBusClient = client;
  } catch (e) {
    console.error("[meetings] LISTEN unavailable — falling back to polling", e);
    globalForBus.meetingBusReady = false;
  }
}

function notifyRoom(meetingId: string): void {
  // Wake anyone waiting on this worker directly — no round trip needed.
  for (const w of waiters) if (w.meetingId === meetingId) w.wake();
  // …and the other worker, through Postgres.
  void db
    .execute(sql`select pg_notify(${CHANNEL}, ${meetingId})`)
    .catch(() => {
      /* the polling safety net covers this */
    });
}

/**
 * Wait until something happens in this room, or `timeoutMs` passes.
 * Resolves either way — the caller re-reads regardless.
 */
export async function waitForRoom(meetingId: string, timeoutMs: number): Promise<void> {
  await ensureBus();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      waiters.delete(waiter);
      clearTimeout(timer);
      resolve();
    };
    const waiter: Waiter = { meetingId, wake: finish };
    waiters.add(waiter);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/* ============================================================
 * The stage, chat and the room's own state
 * ========================================================== */

export async function setStage(meetingId: string, stage: Stage): Promise<void> {
  await db
    .update(meeting)
    .set({ stage: stage as unknown as Record<string, unknown> })
    .where(eq(meeting.id, meetingId));
}

export async function getStage(meetingId: string): Promise<Stage> {
  const [row] = await db
    .select({ stage: meeting.stage })
    .from(meeting)
    .where(eq(meeting.id, meetingId))
    .limit(1);
  return parseStage(row?.stage);
}

export async function addMessage(opts: {
  meetingId: string;
  churchId: string;
  participantId: string | null;
  authorName: string;
  body: string;
  kind?: "chat" | "system";
}): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(meetingMessage)
    .values({
      meetingId: opts.meetingId,
      churchId: opts.churchId,
      participantId: opts.participantId,
      authorName: opts.authorName.slice(0, 80),
      body: opts.body.slice(0, 2000),
      kind: opts.kind ?? "chat",
    })
    .returning({ id: meetingMessage.id, createdAt: meetingMessage.createdAt });
  return row;
}

export async function listMessages(meetingId: string, limit = 300) {
  const rows = await db
    .select({
      id: meetingMessage.id,
      authorName: meetingMessage.authorName,
      body: meetingMessage.body,
      kind: meetingMessage.kind,
      createdAt: meetingMessage.createdAt,
    })
    .from(meetingMessage)
    .where(eq(meetingMessage.meetingId, meetingId))
    .orderBy(asc(meetingMessage.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Close a meeting: everyone marked out, the room marked ended.
 *
 * Safe to call twice — a host pressing "End" while the housekeeping cron is
 * doing the same thing must not produce two different endings.
 */
export async function endMeeting(meetingId: string): Promise<void> {
  await db
    .update(meetingParticipant)
    .set({
      leftAt: new Date(),
      durationSec: sql`greatest(0, extract(epoch from (now() - ${meetingParticipant.joinedAt}))::int)`,
    })
    .where(and(eq(meetingParticipant.meetingId, meetingId), isNull(meetingParticipant.leftAt)));

  await db
    .update(meeting)
    .set({ status: "ended", endedAt: sql`coalesce(${meeting.endedAt}, now())` })
    .where(and(eq(meeting.id, meetingId), inArray(meeting.status, ["scheduled", "live"])));

  notifyRoom(meetingId);
}

/**
 * Everyone who was ever in this meeting, longest stay first — the register.
 * `durationSec` is computed live for anyone still in the room, so the page
 * reads correctly during the meeting as well as after it.
 */
export async function attendanceLog(meetingId: string) {
  return db
    .select({
      id: meetingParticipant.id,
      name: meetingParticipant.displayName,
      role: meetingParticipant.role,
      userId: meetingParticipant.userId,
      memberId: meetingParticipant.memberId,
      joinedAt: meetingParticipant.joinedAt,
      leftAt: meetingParticipant.leftAt,
      seconds: sql<number>`case
        when ${meetingParticipant.leftAt} is null
          then greatest(0, extract(epoch from (now() - ${meetingParticipant.joinedAt}))::int)
        else greatest(0, extract(epoch from (${meetingParticipant.leftAt} - ${meetingParticipant.joinedAt}))::int)
      end`,
      admitted: meetingParticipant.admitted,
      removed: meetingParticipant.removed,
    })
    .from(meetingParticipant)
    .where(eq(meetingParticipant.meetingId, meetingId))
    .orderBy(asc(meetingParticipant.joinedAt));
}

export async function listRecordings(meetingId: string) {
  return db
    .select({
      id: meetingRecording.id,
      title: meetingRecording.title,
      mode: meetingRecording.mode,
      status: meetingRecording.status,
      bytes: meetingRecording.bytes,
      durationSec: meetingRecording.durationSec,
      url: meetingRecording.url,
      mediaId: meetingRecording.mediaId,
      error: meetingRecording.error,
      createdAt: meetingRecording.createdAt,
    })
    .from(meetingRecording)
    .where(eq(meetingRecording.meetingId, meetingId))
    .orderBy(desc(meetingRecording.createdAt));
}

export async function listChurchRecordings(churchId: string, limit = 50) {
  return db
    .select({
      id: meetingRecording.id,
      meetingId: meetingRecording.meetingId,
      title: meetingRecording.title,
      mode: meetingRecording.mode,
      status: meetingRecording.status,
      bytes: meetingRecording.bytes,
      durationSec: meetingRecording.durationSec,
      url: meetingRecording.url,
      createdAt: meetingRecording.createdAt,
      meetingTitle: meeting.title,
    })
    .from(meetingRecording)
    .innerJoin(meeting, eq(meeting.id, meetingRecording.meetingId))
    .where(eq(meetingRecording.churchId, churchId))
    .orderBy(desc(meetingRecording.createdAt))
    .limit(limit);
}

/* ============================================================
 * Housekeeping
 * ========================================================== */

/**
 * Close rooms that nobody left properly.
 *
 * The everyday case is the last person closing their laptop lid: the meeting
 * stays "live" for ever, shows a green dot on the list, and counts towards the
 * church's live total. A meeting with no beating participant for five minutes
 * is over.
 */
export async function endAbandonedMeetings(): Promise<number> {
  const liveRooms = await db
    .select({ id: meeting.id })
    .from(meeting)
    .where(
      and(
        eq(meeting.status, "live"),
        lt(meeting.startedAt, new Date(Date.now() - 5 * 60_000)),
      ),
    )
    .limit(500);
  if (liveRooms.length === 0) return 0;

  // A grouped count joined in JS, rather than a correlated NOT EXISTS — same
  // reason as refreshPeak above.
  const stillBeating = await db
    .select({ meetingId: meetingParticipant.meetingId })
    .from(meetingParticipant)
    .where(
      and(
        inArray(
          meetingParticipant.meetingId,
          liveRooms.map((m) => m.id),
        ),
        isNull(meetingParticipant.leftAt),
        gte(meetingParticipant.lastSeenAt, new Date(Date.now() - 5 * 60_000)),
      ),
    )
    .groupBy(meetingParticipant.meetingId);

  const busy = new Set(stillBeating.map((r) => r.meetingId));
  const stale = liveRooms.filter((m) => !busy.has(m.id));
  for (const m of stale) await endMeeting(m.id);
  return stale.length;
}

/** A scheduled meeting nobody ever opened, hours after its slot, is not coming. */
export async function expireMissedMeetings(): Promise<number> {
  const rows = await db
    .update(meeting)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(meeting.status, "scheduled"),
        isNull(meeting.startedAt),
        lt(meeting.scheduledFor, new Date(Date.now() - 12 * 60 * 60_000)),
      ),
    )
    .returning({ id: meeting.id });
  return rows.length;
}

/* ============================================================
 * Who is this, and what may they do here?
 *
 * A meeting is reached by its link, which means the person arriving may be the
 * pastor, a member signed in on their phone, or a stranger the link was
 * forwarded to. The room has to work out which — for a church it may not be
 * the one they are currently working in, so the usual session helpers (which
 * answer for the ACTIVE church) cannot be used.
 * ========================================================== */

export type ChurchStanding = {
  isStaff: boolean;
  isOwner: boolean;
  perms: Set<string>;
  memberId: string | null;
};

const NO_STANDING: ChurchStanding = {
  isStaff: false,
  isOwner: false,
  perms: new Set(),
  memberId: null,
};

/**
 * What a signed-in user is to THIS church, whatever church they happen to be
 * working in right now.
 */
export async function standingInChurch(
  churchId: string,
  userId: string | null | undefined,
): Promise<ChurchStanding> {
  if (!userId) return NO_STANDING;

  const [s] = await db
    .select({ role: staff.role, roleId: staff.roleId })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.userId, userId)))
    .limit(1);

  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.churchId, churchId), eq(member.userId, userId)))
    .limit(1);
  const memberId = m?.id ?? null;

  if (!s) return { ...NO_STANDING, memberId };
  if (s.role === "owner")
    return { isStaff: true, isOwner: true, perms: new Set(ALL_PERMISSIONS), memberId };

  if (s.roleId) {
    const [r] = await db
      .select({ permissions: role.permissions, isSystem: role.isSystem })
      .from(role)
      .where(and(eq(role.id, s.roleId), eq(role.churchId, churchId)))
      .limit(1);
    if (r) {
      // The locked system role means "everything", today — same reasoning as
      // lib/permissions.ts, which this deliberately mirrors.
      const perms = r.isSystem ? ALL_PERMISSIONS : r.permissions;
      return { isStaff: true, isOwner: false, perms: new Set(perms), memberId };
    }
  }

  if (s.role === "admin")
    return { isStaff: true, isOwner: false, perms: new Set(ALL_PERMISSIONS), memberId };

  return {
    isStaff: true,
    isOwner: false,
    perms: new Set(MEMBER_DEFAULT_PERMISSIONS),
    memberId,
  };
}

export function standingCan(standing: ChurchStanding, perm: string): boolean {
  return standing.isOwner || standing.perms.has(perm);
}

/**
 * The role someone gets on arrival.
 *
 * Whoever the meeting was created for is the host. Anyone who could have
 * created it themselves (meetings.manage) is a co-host, so a service does not
 * fall apart because the one named host is stuck in traffic. Everybody else is
 * an attendee, signed in or not.
 */
export function roleOnJoin(
  m: Pick<Meeting, "hostUserId" | "createdBy" | "hostKey">,
  userId: string | null,
  standing: ChurchStanding,
  hostKey?: string | null,
): MeetingRole {
  if (userId && (m.hostUserId === userId || m.createdBy === userId)) return "host";
  // The host link. Compared in constant time for the same reason the peer
  // secret is — and only ever when the meeting actually has a key, so a null
  // column can never be matched by an empty string.
  if (m.hostKey && hostKey && sameSecret(m.hostKey, hostKey)) return "host";
  if (standingCan(standing, "meetings.manage")) return "cohost";
  return "attendee";
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ============================================================
 * Getting in
 * ========================================================== */

export type AdmissionDenial = {
  ok: false;
  code: "not-found" | "ended" | "cancelled" | "passcode" | "members-only" | "full" | "not-started";
  message: string;
};

export type AdmissionGrant = {
  ok: true;
  role: MeetingRole;
  /** False when the lobby is on and this person has to be let in. */
  admitted: boolean;
};

/**
 * Decide whether this person may come in, before any row is written.
 *
 * Capacity is checked against people actually in the room rather than against
 * everyone who has ever joined, so a meeting that has churned through twenty
 * people over an hour is not "full" with four in it.
 */
export async function evaluateAdmission(opts: {
  meeting: Meeting;
  userId: string | null;
  standing: ChurchStanding;
  passcode: string | null;
  hostKey?: string | null;
}): Promise<AdmissionGrant | AdmissionDenial> {
  const m = opts.meeting;

  if (m.status === "ended")
    return { ok: false, code: "ended", message: "This meeting has already ended." };
  if (m.status === "cancelled")
    return { ok: false, code: "cancelled", message: "This meeting was cancelled." };

  const role = roleOnJoin(m, opts.userId, opts.standing, opts.hostKey);
  const isHost = role === "host" || role === "cohost";

  // Access rules never apply to the people running the meeting — a host
  // locked out of their own room by their own passcode is a support ticket.
  if (!isHost) {
    if (m.access === "members" && !opts.userId)
      return {
        ok: false,
        code: "members-only",
        message: "Sign in with your church account to join this meeting.",
      };
    if (m.access === "members" && !opts.standing.isStaff && !opts.standing.memberId)
      return {
        ok: false,
        code: "members-only",
        message: "This meeting is for members of this church only.",
      };
    if (m.access === "passcode") {
      const given = (opts.passcode ?? "").trim();
      if (!given || !m.passcode || given !== m.passcode)
        return {
          ok: false,
          code: "passcode",
          message: given ? "That passcode isn't right." : "This meeting needs a passcode.",
        };
    }

    const live = await roster(m.id);
    if (live.filter((p) => p.admitted).length >= m.maxParticipants)
      return {
        ok: false,
        code: "full",
        message: `This meeting is full (${m.maxParticipants} people).`,
      };
  }

  return { ok: true, role, admitted: isHost ? true : !m.lobby };
}

/* ============================================================
 * Host powers
 * ========================================================== */

/** Let someone in from the lobby. */
export async function admitParticipant(meetingId: string, participantId: string) {
  const [row] = await db
    .update(meetingParticipant)
    .set({ admitted: true, lastSeenAt: new Date() })
    .where(
      and(eq(meetingParticipant.id, participantId), eq(meetingParticipant.meetingId, meetingId)),
    )
    .returning({ peerId: meetingParticipant.peerId, name: meetingParticipant.displayName });
  if (row) await refreshPeak(meetingId);
  return row ?? null;
}

/**
 * Remove someone, and keep them out.
 *
 * `removed` is what makes this stick: without it, the browser that was just
 * shown the door simply posts to /join again and walks back in.
 */
export async function removeParticipant(meetingId: string, participantId: string) {
  const [row] = await db
    .update(meetingParticipant)
    .set({
      removed: true,
      admitted: false,
      leftAt: new Date(),
      micOn: false,
      cameraOn: false,
      sharing: false,
      durationSec: sql`greatest(0, extract(epoch from (now() - ${meetingParticipant.joinedAt}))::int)`,
    })
    .where(
      and(eq(meetingParticipant.id, participantId), eq(meetingParticipant.meetingId, meetingId)),
    )
    .returning({
      peerId: meetingParticipant.peerId,
      name: meetingParticipant.displayName,
      userId: meetingParticipant.userId,
    });
  return row ?? null;
}

/** Promote or demote. A meeting always keeps at least its original host. */
export async function setParticipantRole(
  meetingId: string,
  participantId: string,
  role: MeetingRole,
) {
  const [row] = await db
    .update(meetingParticipant)
    .set({ role })
    .where(
      and(eq(meetingParticipant.id, participantId), eq(meetingParticipant.meetingId, meetingId)),
    )
    .returning({ peerId: meetingParticipant.peerId, name: meetingParticipant.displayName });
  return row ?? null;
}

/**
 * Mute is advisory, and honestly so: the server cannot reach into a phone and
 * switch off its microphone. It writes the state and asks the browser to
 * comply, and every browser we support does. What it CAN guarantee is that
 * everyone else stops rendering that audio, which is the part a host actually
 * needs when someone leaves their mic open in a service.
 */
export async function requestMute(meetingId: string, participantIds?: string[]) {
  const where = participantIds?.length
    ? and(
        eq(meetingParticipant.meetingId, meetingId),
        inArray(meetingParticipant.id, participantIds),
      )
    : and(
        eq(meetingParticipant.meetingId, meetingId),
        isNull(meetingParticipant.leftAt),
        inArray(meetingParticipant.role, ["attendee", "speaker"]),
      );
  const rows = await db
    .update(meetingParticipant)
    .set({ micOn: false })
    .where(where)
    .returning({ peerId: meetingParticipant.peerId });
  return rows.map((r) => r.peerId);
}

/** Lower every hand at once — the end of a Q&A. */
export async function lowerAllHands(meetingId: string) {
  await db
    .update(meetingParticipant)
    .set({ handRaised: false })
    .where(
      and(eq(meetingParticipant.meetingId, meetingId), eq(meetingParticipant.handRaised, true)),
    );
}

/* ============================================================
 * Recordings
 * ========================================================== */

export async function startRecordingRow(opts: {
  meetingId: string;
  churchId: string;
  title: string;
  mode: "video" | "audio";
  createdBy: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(meetingRecording)
    .values({
      meetingId: opts.meetingId,
      churchId: opts.churchId,
      title: opts.title.slice(0, 200),
      mode: opts.mode,
      status: "uploading",
      startedAt: new Date(),
      createdBy: opts.createdBy,
    })
    .returning({ id: meetingRecording.id });
  return row.id;
}

export async function completeRecording(opts: {
  id: string;
  churchId: string;
  mediaId?: string | null;
  url?: string | null;
  bytes?: number;
  durationSec?: number;
  status: "ready" | "failed" | "local-only";
  error?: string | null;
}): Promise<void> {
  await db
    .update(meetingRecording)
    .set({
      mediaId: opts.mediaId ?? null,
      url: opts.url ?? null,
      bytes: opts.bytes ?? 0,
      durationSec: opts.durationSec ?? 0,
      status: opts.status,
      error: opts.error ?? null,
    })
    .where(
      and(eq(meetingRecording.id, opts.id), eq(meetingRecording.churchId, opts.churchId)),
    );
}
