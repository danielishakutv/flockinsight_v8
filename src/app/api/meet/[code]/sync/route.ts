import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meeting, meetingParticipant } from "@/db/schema";
import {
  getMeetingByCode,
  heartbeat,
  postSignals,
  readSignals,
  roster,
  signalCursor,
  waitForRoom,
} from "@/lib/meetings";
import {
  mediaRights,
  parseStage,
  SIGNAL_TYPES,
  type SignalType,
} from "@/lib/meetings-shared";
import { fail, json, readJson, requirePeer } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How long a listening request is held open.
 *
 * This is the transport. Not SSE and not a socket: a long-poll survives every
 * proxy, every corporate firewall and every mobile browser without special
 * configuration, and it carries the peer's outgoing signals in the same
 * request that collects its incoming ones. Fifteen seconds is short enough to
 * sit well inside Cloudflare's and Apache's timeouts, long enough that an idle
 * room costs four requests a minute per person.
 *
 * Latency does not depend on this number — a write anywhere in the cluster
 * wakes the waiters through Postgres NOTIFY, usually within a few
 * milliseconds. The timer is only the safety net.
 *
 * It must also stay comfortably under PRESENCE_TIMEOUT_MS: the hold is the
 * widest gap between a listening peer's heartbeats, and if the two numbers get
 * close, peers flicker out of each other's rosters and their connections are
 * torn down and rebuilt on a link that was working fine.
 */
const HOLD_MS = 12_000;
/** Re-read on this cadence even if no notification arrives. */
const RECHECK_MS = 3_000;

type Incoming = {
  peer?: unknown;
  secret?: unknown;
  cursor?: unknown;
  wait?: unknown;
  state?: Record<string, unknown>;
  signals?: unknown;
};

type OutgoingSignal = { toPeer?: string | null; type: SignalType; payload: Record<string, unknown> };

function parseSignals(raw: unknown): OutgoingSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: OutgoingSignal[] = [];
  for (const item of raw.slice(0, 60)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const type = typeof s.type === "string" ? s.type : "";
    // Only the peer-to-peer types may be posted by a client. Anything that
    // changes the room — control, stage, roster — goes through /action, where
    // the caller's role is checked.
    if (!SIGNAL_TYPES.includes(type as SignalType)) continue;
    if (
      !["offer", "answer", "ice", "bye", "pause", "reaction", "renegotiate"].includes(
        type,
      )
    )
      continue;
    const payload =
      s.payload && typeof s.payload === "object"
        ? (s.payload as Record<string, unknown>)
        : {};
    out.push({
      toPeer: typeof s.to === "string" ? s.to : null,
      type: type as SignalType,
      payload,
    });
  }
  return out;
}

function parseState(
  raw: Record<string, unknown> | undefined,
  /** What this peer is allowed to have on. See `mediaRights`. */
  rights: { mic: boolean; camera: boolean },
) {
  if (!raw) return null;
  const bool = (k: string) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : undefined);
  const quality =
    typeof raw.quality === "string" &&
    ["good", "fair", "poor", "lost"].includes(raw.quality)
      ? (raw.quality as "good" | "fair" | "poor" | "lost")
      : undefined;

  const num = (k: string) => {
    const v = raw[k];
    // Bounded: a browser could claim anything, and this figure becomes money.
    // A terabyte from one participant is a bug or a lie either way.
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
    return Math.min(Math.floor(v), 1_000_000_000_000);
  };

  /*
   * A room where only the platform may speak does not record anybody else as
   * unmuted, whatever their browser says.
   *
   * The browser refuses to open the microphone and the control is dead in the
   * interface, so reaching this line means a stale page, a second tab or
   * somebody who has just been demoted from speaker — all of which are
   * ordinary, and none of which should leave a live microphone icon beside
   * their name for the whole room. Clamped rather than rejected: the rest of
   * the state in the same push is honest and worth keeping.
   */
  const micOn = rights.mic ? bool("micOn") : bool("micOn") === undefined ? undefined : false;
  const cameraOn = rights.camera
    ? bool("cameraOn")
    : bool("cameraOn") === undefined
      ? undefined
      : false;

  const state = {
    bytesReceived: num("bytesReceived"),
    bytesSent: num("bytesSent"),
    micOn,
    cameraOn,
    sharing: bool("sharing"),
    handRaised: bool("handRaised"),
    lowData: bool("lowData"),
    quality,
  };
  const defined = Object.fromEntries(
    Object.entries(state).filter(([, v]) => v !== undefined),
  );
  return Object.keys(defined).length > 0 ? defined : null;
}

/**
 * POST /api/meet/<code>/sync — the one hot path.
 *
 * Sends this peer's signals, keeps its heartbeat alive, and returns whatever
 * has arrived for it. Called with `wait: false` to fire something off
 * immediately, and with `wait: true` in a loop to listen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await readJson<Incoming>(request);

  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404, { code: "not-found" });

  const peer = await requirePeer(m.id, body);
  if (!peer)
    return fail("You've been signed out of this meeting.", 401, { code: "stale-peer" });

  /*
   * An ended room answers once and says so.
   *
   * Nothing is posted on, nothing is held open, and no heartbeat is taken: a
   * peer arriving here after the room closed is a tab that was asleep or on a
   * bad link, and the only thing it needs from us is the news. Relaying its
   * offers and candidates into a closed room would let two stale tabs rebuild
   * a call that everybody else has left.
   */
  if (m.status === "ended" || m.status === "cancelled") {
    return json({
      ok: true,
      ended: true,
      status: m.status,
      cursor: Number.isFinite(Number(body?.cursor)) ? Number(body?.cursor) : 0,
      signals: [],
      roster: [],
      serverTime: new Date().toISOString(),
    });
  }

  const cursor = Number.isFinite(Number(body?.cursor)) ? Number(body?.cursor) : 0;
  const wait = body?.wait === true;
  const state = parseState(body?.state, mediaRights(peer.role, m));

  await heartbeat(peer.id, state ?? undefined);

  // A state change is announced by the server rather than the client, so every
  // participant's roster is updated from one authority and cannot drift.
  const outgoing = parseSignals(body?.signals);
  if (state) {
    outgoing.push({
      toPeer: null,
      type: "state",
      payload: { peerId: peer.peerId, ...state },
    });
  }
  if (outgoing.length > 0) await postSignals(m.id, peer.peerId, outgoing);

  // Someone still in the lobby gets nothing but the news that they are in it.
  if (!peer.admitted) {
    const [row] = await db
      .select({ admitted: meetingParticipant.admitted, removed: meetingParticipant.removed })
      .from(meetingParticipant)
      .where(eq(meetingParticipant.id, peer.id))
      .limit(1);
    if (row?.removed)
      return json({ ok: true, removed: true, reason: "The host didn't let you in." });
    if (!row?.admitted) {
      if (wait) await waitForRoom(m.id, HOLD_MS);
      return json({ ok: true, waitingForHost: true, cursor });
    }
  }

  let signals = await readSignals(m.id, peer.peerId, cursor);

  if (wait && signals.length === 0) {
    const deadline = Date.now() + HOLD_MS;
    while (signals.length === 0 && Date.now() < deadline) {
      await waitForRoom(m.id, Math.min(RECHECK_MS, deadline - Date.now()));
      signals = await readSignals(m.id, peer.peerId, cursor);
    }
    // The hold is also the heartbeat — touch the row on the way out so a
    // listening peer is never mistaken for a departed one.
    await heartbeat(peer.id);
  }

  const nextCursor =
    signals.length > 0 ? signals[signals.length - 1].id : await signalCursor(m.id);

  const [people, current] = await Promise.all([
    roster(m.id),
    db
      .select({
        status: meeting.status,
        stage: meeting.stage,
        slides: meeting.slides,
        spotlightPeerId: meeting.spotlightPeerId,
      })
      .from(meeting)
      .where(eq(meeting.id, m.id))
      .limit(1),
  ]);

  const room = current[0];

  return json({
    ok: true,
    cursor: nextCursor,
    signals,
    roster: people,
    stage: parseStage(room?.stage),
    slides: room?.slides ?? [],
    spotlightPeerId: room?.spotlightPeerId ?? null,
    status: room?.status ?? m.status,
    ended: room?.status === "ended" || room?.status === "cancelled",
    serverTime: new Date().toISOString(),
  });
}
