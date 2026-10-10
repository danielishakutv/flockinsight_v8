import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingParticipant } from "@/db/schema";
import { getMeetingByCode } from "@/lib/meetings";
import {
  closeTracks,
  newSession,
  publishTracks,
  pullTracks,
  renegotiate,
  SfuError,
  TRACK_NAMES,
  type LocalTrack,
  type RemoteTrack,
  type SessionDescription,
} from "@/lib/sfu";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fail, json, readJson, requirePeer } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/sfu — everything a browser needs from the media server.
 *
 * A proxy, and that is the point. The Cloudflare app secret can create sessions
 * and pull anybody's track in the account; it never goes near a browser. Every
 * call here authenticates the caller as a participant of THIS meeting first,
 * with the per-peer secret that already guards every other write, and only then
 * speaks to Cloudflare on their behalf.
 *
 * It is also where the two things a client must not be trusted with live:
 *
 *   - the publisher session id is written to that participant's own row, so the
 *     roster can carry it. A peer cannot claim somebody else's.
 *   - a pull names `(sessionId, trackName)` and the session ids are checked
 *     against the roster of this meeting, so a participant of one room cannot
 *     subscribe to a session in another.
 *
 * Track names are fixed (`mic`, `cam`, `screen`), so nothing about them has to
 * be exchanged: seeing somebody in the roster is enough to know what to ask for.
 */

type Body = {
  peer?: unknown;
  secret?: unknown;
  action?: unknown;
  session?: unknown;
  /** The proof that this session was minted for this peer. */
  proof?: unknown;
  sdp?: unknown;
  tracks?: unknown;
  mids?: unknown;
};

/** The only track names this room will ever ask for. */
const ALLOWED_NAMES = new Set<string>(Object.values(TRACK_NAMES));

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function description(v: unknown): SessionDescription | null {
  if (!v || typeof v !== "object") return null;
  const d = v as { type?: unknown; sdp?: unknown };
  if (d.type !== "offer" && d.type !== "answer") return null;
  if (typeof d.sdp !== "string" || d.sdp.length === 0) return null;
  // SDP is large but not unbounded; a megabyte of it is an attack, not a call.
  if (d.sdp.length > 200_000) return null;
  return { type: d.type, sdp: d.sdp };
}

/* ============================================================
 * Proving a session belongs to the caller
 *
 * Every action but "session" names a Cloudflare session id, and the id of
 * everybody's PUBLISHER is broadcast to the whole room in every roster — it
 * has to be, because that is how anybody pulls anybody. So a session id is
 * public knowledge, and it was also the only thing these actions checked.
 *
 * "pull" did verify that the session named belonged to this meeting. "close",
 * "renegotiate" and "publish" verified nothing at all, which meant any
 * authenticated guest could post
 *
 *     { action: "close", session: "<the preacher's session>", mids: ["0","1","2"] }
 *
 * and take that person's microphone, camera and screen away from everybody for
 * the rest of the meeting — silently, because a forced close skips
 * renegotiation and the victim's connection stays up. "publish" was worse: the
 * id went straight onto the CALLER's row, so a guest could make the roster
 * point at somebody else's media.
 *
 * The fix needs no new table. When a session is minted, the route hands back a
 * short proof alongside it: an HMAC over (this participant, that session) with
 * a server secret the browser never sees. Later actions send the proof back
 * and it is recomputed. A session id remains public; a session id WITH a valid
 * proof means "the server gave this to you".
 * ========================================================== */

function sessionProof(participantId: string, sessionId: string): string {
  const secret =
    process.env.BETTER_AUTH_SECRET || process.env.CRON_SECRET || "flockinsight-dev";
  return createHmac("sha256", secret)
    .update(`sfu:${participantId}:${sessionId}`)
    .digest("base64url");
}

/** Constant-time, because this is a signature check. */
function proofHolds(participantId: string, sessionId: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const expected = sessionProof(participantId, sessionId);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await readJson<Body>(request);

  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404);

  const peer = await requirePeer(m.id, body);
  if (!peer) return fail("You've been signed out of this meeting.", 401);

  const action = str(body?.action, 32);

  /*
   * Nobody in the lobby touches the media server.
   *
   * This was never checked, so somebody held at the door — not admitted, not
   * visible in the roster, possibly refused a moment later — could mint a
   * session and pull every microphone in the meeting. A waiting room that does
   * not stop someone listening is not a waiting room.
   */
  if (!peer.admitted) return fail("You're still waiting to be let in.", 403);

  /*
   * And every action but the first has to prove the session is its own.
   */
  if (action !== "session") {
    const sessionId = str(body?.session, 200);
    if (!sessionId) return fail("Malformed request.", 400);
    if (!proofHolds(peer.id, sessionId, body?.proof)) {
      console.warn(
        `[sfu] ${peer.peerId} named session ${sessionId.slice(0, 8)}… without a valid proof`,
      );
      return fail("That media session isn't yours.", 403);
    }
  }

  try {
    switch (action) {
      /* ------------------------------------------------- a new session */
      case "session": {
        const sessionId = await newSession();
        // The proof travels with it, and only ever to the peer it was made
        // for. See the note above.
        return json({ ok: true, sessionId, proof: sessionProof(peer.id, sessionId) });
      }

      /* ------------------------------------------- publish my own media */
      case "publish": {
        const sessionId = str(body?.session, 200);
        const offer = description(body?.sdp);
        if (!sessionId || !offer) return fail("Malformed publish.", 400);

        const raw = Array.isArray(body?.tracks) ? body.tracks : [];
        const tracks: LocalTrack[] = [];
        for (const t of raw) {
          const mid = str((t as { mid?: unknown })?.mid, 16);
          const trackName = str((t as { trackName?: unknown })?.trackName, 32);
          if (!mid || !ALLOWED_NAMES.has(trackName)) continue;
          tracks.push({ location: "local", mid, trackName });
        }
        if (tracks.length === 0) return fail("Nothing to publish.", 400);

        const result = await publishTracks(sessionId, offer, tracks);

        /*
         * Remember where they publish, so the roster can tell everybody else.
         * Safe to take from the body now only because the proof above
         * establishes that this session was minted for THIS participant —
         * without it, a guest could point the room at somebody else's media.
         */
        await db
          .update(meetingParticipant)
          .set({ sfuSessionId: sessionId })
          .where(eq(meetingParticipant.id, peer.id));

        return json({ ok: true, ...result });
      }

      /* ------------------------------------ subscribe to everybody else */
      case "pull": {
        const sessionId = str(body?.session, 200);
        if (!sessionId) return fail("Malformed pull.", 400);

        const raw = Array.isArray(body?.tracks) ? body.tracks : [];
        const wanted: RemoteTrack[] = [];
        for (const t of raw) {
          const from = str((t as { sessionId?: unknown })?.sessionId, 200);
          const trackName = str((t as { trackName?: unknown })?.trackName, 32);
          if (!from || !ALLOWED_NAMES.has(trackName)) continue;
          wanted.push({ location: "remote", sessionId: from, trackName });
        }
        if (wanted.length === 0) return fail("Nothing to pull.", 400);

        /*
         * Only sessions belonging to THIS meeting. Without this a participant
         * of any room could subscribe to a session id from another one and
         * listen to a meeting they were never admitted to — the session id is
         * the only thing standing between rooms, and it travels in rosters.
         */
        const here = await db
          .select({ sfuSessionId: meetingParticipant.sfuSessionId })
          .from(meetingParticipant)
          .where(eq(meetingParticipant.meetingId, m.id));
        const inRoom = new Set(
          here.map((r) => r.sfuSessionId).filter((x): x is string => !!x),
        );

        const allowed = wanted.filter((t) => inRoom.has(t.sessionId));
        if (allowed.length === 0) {
          return fail("Those people are no longer in this meeting.", 404);
        }

        const result = await pullTracks(sessionId, allowed);
        return json({ ok: true, ...result });
      }

      /* ------------------------------ answer an offer the SFU just made */
      case "renegotiate": {
        const sessionId = str(body?.session, 200);
        const answer = description(body?.sdp);
        if (!sessionId || !answer) return fail("Malformed renegotiation.", 400);

        await renegotiate(sessionId, answer);
        return json({ ok: true });
      }

      /* ------------------------------------------------- stop some tracks */
      case "close": {
        const sessionId = str(body?.session, 200);
        const mids = Array.isArray(body?.mids)
          ? body.mids.map((x) => str(x, 16)).filter(Boolean)
          : [];
        if (!sessionId || mids.length === 0) return fail("Nothing to close.", 400);

        const result = await closeTracks(sessionId, mids);
        return json({ ok: true, ...result });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (e) {
    if (e instanceof SfuError) {
      // Cloudflare's own words where there are any: "session not found" is
      // worth far more to whoever reads the log than a bare 502.
      console.error(`[sfu] ${action} failed: ${e.message}`, e.code ?? "");
      return fail(e.message, e.status >= 500 ? 502 : e.status);
    }
    console.error("[sfu] unexpected failure", e);
    return fail("The media server could not be reached.", 502);
  }
}
