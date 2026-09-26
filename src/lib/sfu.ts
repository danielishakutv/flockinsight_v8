import "server-only";

/**
 * Cloudflare Realtime SFU — the server half.
 *
 * A mesh makes every person send their video to every other person, so upload
 * grows with the room: `profileFor` is already down to 320x180 at twelve people
 * and a phone is encoding eleven streams at once. That is the ceiling, and no
 * amount of tuning moves it.
 *
 * An SFU moves the fan-out to a server. Everybody uploads ONCE, and downloads
 * only the people actually on screen, so a person's cost stops depending on how
 * many others are in the room. Cloudflare's is a low-level tracks API rather
 * than a conferencing SDK, which is exactly what is wanted here: the meeting UI,
 * the roster, the stage, the recording and the signalling all stay as they are
 * and only the transport changes.
 *
 * WHY THIS IS SERVER-SIDE. The app secret grants the right to create sessions
 * and pull anybody's track. It never goes near a browser; the client talks to
 * our own routes, which check the peer's meeting secret first and then speak to
 * Cloudflare on their behalf.
 *
 * THE SHAPE OF IT. Each participant holds two peer connections to the SFU:
 *
 *   publisher  — sendonly. Its tracks are named "mic", "cam" and "screen", and
 *                they live under that participant's own session id.
 *   subscriber — recvonly. It pulls `(sessionId, trackName)` pairs belonging to
 *                everybody else, which it learns from the roster we already
 *                send on every poll.
 *
 * Two connections rather than one because publishing and subscribing
 * renegotiate independently: somebody turning their camera on must not disturb
 * what everyone else is receiving.
 *
 * ORDERING MATTERS. Cloudflare rejects concurrent mutations of one session with
 * a 406. Each session is mutated only by the browser that owns it, so the
 * ordering is enforced there, in one queue per connection — see
 * `meeting-sfu.ts`. Nothing here needs a lock.
 *
 * Env:
 *   CLOUDFLARE_REALTIME_APP_ID      the Realtime app's id
 *   CLOUDFLARE_REALTIME_APP_SECRET  its secret. Server-side only.
 */

const BASE = "https://rtc.live.cloudflare.com/v1";

/** How long any one call to Cloudflare may take before we give up on it. */
const TIMEOUT_MS = 8000;

export type SessionDescription = { type: "offer" | "answer"; sdp: string };

/** A track this participant is sending, identified by its transceiver's mid. */
export type LocalTrack = { location: "local"; mid: string; trackName: string };

/** Somebody else's track, identified by whose it is and what it is called. */
export type RemoteTrack = {
  location: "remote";
  sessionId: string;
  trackName: string;
};

export type TrackResult = {
  trackName?: string;
  mid?: string;
  sessionId?: string;
  error?: { errorCode?: string; errorDescription?: string };
};

export type TracksResponse = {
  sessionDescription?: SessionDescription;
  tracks?: TrackResult[];
  requiresImmediateRenegotiation?: boolean;
  errorCode?: string;
  errorDescription?: string;
};

export function isSfuConfigured(): boolean {
  return !!(
    process.env.CLOUDFLARE_REALTIME_APP_ID &&
    process.env.CLOUDFLARE_REALTIME_APP_SECRET
  );
}

/**
 * The fixed names a participant's tracks go by.
 *
 * Constant rather than generated, because a track is already scoped by the
 * session it belongs to — `(sessionId, "cam")` is unique across the room. It
 * also means a subscriber knows what to ask for without being told: seeing
 * somebody in the roster is enough.
 */
export const TRACK_NAMES = {
  mic: "mic",
  camera: "cam",
  screen: "screen",
} as const;

export type TrackName = (typeof TRACK_NAMES)[keyof typeof TRACK_NAMES];

class SfuError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SfuError";
  }
}

async function call<T>(
  path: string,
  init: { method: "POST" | "PUT" | "GET"; body?: unknown },
): Promise<T> {
  const appId = process.env.CLOUDFLARE_REALTIME_APP_ID;
  const secret = process.env.CLOUDFLARE_REALTIME_APP_SECRET;
  if (!appId || !secret) {
    throw new SfuError("The SFU is not configured on this server.", 503);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/apps/${appId}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // A timeout or a DNS failure. Distinct from a rejection, because the
    // caller can retry this one.
    throw new SfuError(
      `Could not reach the media server: ${(e as Error).message}`,
      504,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* a body that is not JSON is reported through the status below */
  }

  if (!res.ok) {
    const body = data as { errorDescription?: string; errorCode?: string } | null;
    throw new SfuError(
      body?.errorDescription ?? `The media server refused the request (${res.status}).`,
      res.status,
      body?.errorCode,
    );
  }

  return data as T;
}

/** A fresh session. One per peer connection, so two per participant. */
export async function newSession(): Promise<string> {
  const data = await call<{ sessionId?: string }>("/sessions/new", {
    method: "POST",
  });
  if (!data?.sessionId) {
    throw new SfuError("The media server did not return a session.", 502);
  }
  return data.sessionId;
}

/**
 * Publish this participant's own tracks.
 *
 * Takes their offer and returns the SFU's answer. The mids come from the
 * transceivers the browser created, which is how the SFU knows which m-line
 * carries which named track.
 */
export async function publishTracks(
  sessionId: string,
  offer: SessionDescription,
  tracks: LocalTrack[],
): Promise<TracksResponse> {
  return call<TracksResponse>(`/sessions/${sessionId}/tracks/new`, {
    method: "POST",
    body: { sessionDescription: offer, tracks },
  });
}

/**
 * Subscribe to other people's tracks.
 *
 * The SFU answers with an OFFER — the opposite way round from publishing,
 * because it is the one adding media to the connection. The browser answers it
 * and sends that back through `renegotiate`.
 */
export async function pullTracks(
  sessionId: string,
  tracks: RemoteTrack[],
): Promise<TracksResponse> {
  return call<TracksResponse>(`/sessions/${sessionId}/tracks/new`, {
    method: "POST",
    body: { tracks },
  });
}

/** Hand back the answer to an offer the SFU made while adding tracks. */
export async function renegotiate(
  sessionId: string,
  answer: SessionDescription,
): Promise<void> {
  await call(`/sessions/${sessionId}/renegotiate`, {
    method: "PUT",
    body: { sessionDescription: answer },
  });
}

/**
 * Stop tracks — somebody left, or turned their camera off for good.
 *
 * `force` closes them without waiting for a renegotiation round trip, which is
 * what is wanted when the far end has already gone.
 */
export async function closeTracks(
  sessionId: string,
  mids: string[],
  force = true,
): Promise<TracksResponse> {
  return call<TracksResponse>(`/sessions/${sessionId}/tracks/close`, {
    method: "PUT",
    body: { tracks: mids.map((mid) => ({ mid })), force },
  });
}

export { SfuError };
