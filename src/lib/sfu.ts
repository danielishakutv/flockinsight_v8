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

// The track names live in `meetings-shared` so both halves share one
// vocabulary; this module is server-only and the browser needs them too.
export { TRACK_NAMES, type TrackName } from "@/lib/meetings-shared";

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

  /*
   * Timed, per endpoint. Calls from this box to the media server have been
   * seen to hit the eight-second timeout in bursts while a probe from the same
   * box answered in under 120ms — so which endpoint stalls, and for how long,
   * is the measurement that tells "Cloudflare holds this request" apart from
   * "this process stalled". The session id is masked; the shape is the point.
   */
  const started = Date.now();
  const endpoint = `${init.method} ${path.replace(/\/sessions\/[^/]+/, "/sessions/:id")}`;
  const logSlow = (outcome: string) => {
    const ms = Date.now() - started;
    if (ms >= 2000) console.warn(`[sfu] slow media server call: ${endpoint} ${outcome} after ${ms}ms`);
  };

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
    logSlow(`failed (${(e as Error).name})`);
    throw new SfuError(
      `Could not reach the media server: ${(e as Error).message}`,
      504,
    );
  }

  const text = await res.text();
  logSlow(String(res.status));
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

/* ============================================================
 * WebSocket adapters — how the recording service hears a room
 *
 * The media server will stream any published track to a WebSocket endpoint
 * of ours, decoded: a microphone as PCM, a camera as JPEG frames. That is
 * what a server-side recording is built on. No WebRTC on the VPS, no browser
 * in the loop, and the server retries the endpoint by itself for fifteen
 * seconds if our process restarts underneath it.
 *
 * One adapter per (session, track). The endpoint carries its own credential
 * in the path — the adapter cannot send headers — see `recorder/tokens.ts`.
 * ========================================================== */

export type AdapterRequest = {
  location: "remote";
  sessionId: string;
  trackName: string;
  /** A `wss://` URL. Localhost is not reachable; redirects are not followed. */
  endpoint: string;
  outputCodec: "pcm" | "jpeg";
};

export type AdapterResult = {
  adapterId?: string;
  trackName?: string;
  sessionId?: string;
  endpoint?: string;
  errorCode?: string;
  errorDescription?: string;
};

/**
 * Ask the media server to start streaming these tracks to us. One to four
 * per call. A 200 can still carry per-item failures, and only every item
 * failing is a non-2xx — so the caller reads each entry.
 */
export async function createWebSocketAdapters(
  tracks: AdapterRequest[],
): Promise<{ tracks: AdapterResult[] }> {
  if (tracks.length === 0 || tracks.length > 4) {
    throw new SfuError("An adapter request takes one to four tracks.", 400);
  }
  const data = await call<{ tracks?: AdapterResult[] }>("/adapters/websocket/new", {
    method: "POST",
    body: { tracks },
  });
  return { tracks: data?.tracks ?? [] };
}

/** Stop streaming. Idempotent: an adapter already gone counts as closed. */
export async function closeWebSocketAdapters(
  adapterIds: string[],
): Promise<{ tracks: { adapterId?: string; bytesProcessed?: number; errorCode?: string; errorDescription?: string }[] }> {
  if (adapterIds.length === 0) return { tracks: [] };
  if (adapterIds.length > 4) {
    throw new SfuError("An adapter close takes one to four adapters.", 400);
  }
  const data = await call<{ tracks?: { adapterId?: string; bytesProcessed?: number; errorCode?: string; errorDescription?: string }[] }>(
    "/adapters/websocket/close",
    { method: "POST", body: { tracks: adapterIds.map((adapterId) => ({ adapterId })) } },
  );
  return { tracks: data?.tracks ?? [] };
}

export { SfuError };
