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

  try {
    switch (action) {
      /* ------------------------------------------------- a new session */
      case "session": {
        const sessionId = await newSession();
        return json({ ok: true, sessionId });
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
         * Written server-side from the session WE created for them — a client
         * that could name its own would be able to point the room at
         * somebody else's media.
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
