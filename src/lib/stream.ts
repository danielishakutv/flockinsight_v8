import "server-only";

/**
 * Cloudflare Stream Live — the server half of livestreaming.
 *
 * A livestream is not a meeting and is deliberately not built on one. A meeting
 * is a roster of people who can all be heard; a stream is one broadcaster and
 * an audience that may be in the thousands and never speaks. Sharing the code
 * would mean a peer connection per viewer, which is the exact thing an SFU was
 * introduced to stop.
 *
 * TWO WAYS IN, and the difference decides what a church can do:
 *
 *   WHIP  — straight from a browser. Nothing to install, nothing to configure,
 *           and viewers watch over WebRTC with about a second of latency. But
 *           Cloudflare does NOT simulcast a WHIP input: no YouTube, no
 *           Facebook, no HLS. WHIP in, WHEP out, and that is all.
 *   RTMP  — from OBS, or the hardware encoder a church that already streams
 *           almost certainly owns. This is the one that can be forwarded to
 *           YouTube and Facebook, and that gives HLS for embedding anywhere.
 *
 * So both are offered on the same livestream, and the UI says plainly which
 * one buys what. Pretending a browser can reach YouTube would be a promise
 * broken on a Sunday morning.
 *
 * Env:
 *   CLOUDFLARE_ACCOUNT_ID        the account the Stream product lives in
 *   CLOUDFLARE_STREAM_API_TOKEN  a token with Stream:Edit. Server-side only.
 */

const API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 10_000;

export type LiveInput = {
  uid: string;
  /** Publish straight from a browser. No simulcasting from this one. */
  whipUrl: string | null;
  /** Watch over WebRTC, about a second behind. */
  whepUrl: string | null;
  /** For OBS and hardware encoders. This is the one that can be forwarded on. */
  rtmpUrl: string | null;
  rtmpStreamKey: string | null;
  /** HLS, for embedding anywhere. Only produced by an RTMP or SRT ingest. */
  hlsUrl: string | null;
};

export type LiveOutput = {
  uid: string;
  url: string;
  enabled: boolean;
};

class StreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

export function isStreamConfigured(): boolean {
  return !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_API_TOKEN
  );
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
): Promise<T> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!account || !token) {
    throw new StreamError("Livestreaming is not set up on this server.", 503);
  }

  let res: Response;
  try {
    res = await fetch(`${API}/accounts/${account}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new StreamError(
      `Could not reach the streaming service: ${(e as Error).message}`,
      504,
    );
  }

  const data = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: unknown;
    errors?: { message?: string }[];
  } | null;

  if (!res.ok || data?.success === false) {
    // Cloudflare's own message where there is one: "live input not found" is
    // worth far more in a log than a bare 400.
    const why = data?.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new StreamError(why || `The streaming service refused (${res.status}).`, res.status);
  }

  return data?.result as T;
}

type RawInput = {
  uid?: string;
  webRTC?: { url?: string };
  webRTCPlayback?: { url?: string };
  rtmps?: { url?: string; streamKey?: string };
};

function shape(raw: RawInput): LiveInput {
  const uid = raw.uid ?? "";
  return {
    uid,
    whipUrl: raw.webRTC?.url ?? null,
    whepUrl: raw.webRTCPlayback?.url ?? null,
    rtmpUrl: raw.rtmps?.url ?? null,
    rtmpStreamKey: raw.rtmps?.streamKey ?? null,
    // Built from the uid rather than read back, because Cloudflare only
    // includes playback urls once something has actually been ingested — and
    // the page needs a url to render before the first broadcast.
    hlsUrl: uid
      ? `https://customer-${process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE ?? ""}.cloudflarestream.com/${uid}/manifest/video.m3u8`
      : null,
  };
}

/**
 * A live input, which is the thing a church broadcasts into.
 *
 * `meta.name` is what shows in the Cloudflare dashboard, so it carries the
 * church and the title — somebody looking at a bill or a stuck stream should
 * not have to join a uid back to a row by hand.
 *
 * Recording is on: a service that was streamed is a service the church will
 * want afterwards, and turning it on later does not retrieve what was missed.
 */
export async function createLiveInput(opts: {
  name: string;
  /** Seconds of DVR. Zero means live only. */
  timeoutSeconds?: number;
}): Promise<LiveInput> {
  const raw = await call<RawInput>("/stream/live_inputs", {
    method: "POST",
    body: {
      meta: { name: opts.name.slice(0, 120) },
      recording: { mode: "automatic", requireSignedURLs: false, allowedOrigins: null },
      deleteRecordingAfterDays: null,
    },
  });
  return shape(raw ?? {});
}

export async function getLiveInput(uid: string): Promise<LiveInput> {
  const raw = await call<RawInput>(`/stream/live_inputs/${uid}`, { method: "GET" });
  return shape(raw ?? {});
}

/**
 * Delete the input, and everything recorded through it.
 *
 * Called when a church deletes a livestream. Never called on ending a
 * broadcast — ending is a state, and the recording outlives it.
 */
export async function deleteLiveInput(uid: string): Promise<void> {
  await call(`/stream/live_inputs/${uid}`, { method: "DELETE" });
}

/**
 * Forward this stream to somebody else's platform.
 *
 * Only takes effect for an RTMP or SRT ingest. A WHIP broadcast from a browser
 * is not forwarded, which is a limit of the service rather than a choice, and
 * the UI says so where a church enters these.
 */
export async function addOutput(
  inputUid: string,
  opts: { url: string; streamKey: string },
): Promise<LiveOutput> {
  const raw = await call<{ uid?: string; url?: string; enabled?: boolean }>(
    `/stream/live_inputs/${inputUid}/outputs`,
    { method: "POST", body: { url: opts.url, streamKey: opts.streamKey, enabled: true } },
  );
  return { uid: raw?.uid ?? "", url: raw?.url ?? opts.url, enabled: raw?.enabled ?? true };
}

export async function removeOutput(inputUid: string, outputUid: string): Promise<void> {
  await call(`/stream/live_inputs/${inputUid}/outputs/${outputUid}`, {
    method: "DELETE",
  });
}

/** Is anything actually arriving? Drives the "live" dot without trusting a click. */
export async function inputStatus(
  uid: string,
): Promise<{ live: boolean; state: string | null }> {
  const raw = await call<{ status?: { current?: { state?: string } } }>(
    `/stream/live_inputs/${uid}`,
    { method: "GET" },
  );
  const state = raw?.status?.current?.state ?? null;
  return { live: state === "connected", state };
}

/** The RTMP endpoints churches actually use, so nobody has to go and find them. */
export const STREAM_TARGETS = [
  { id: "youtube", label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2" },
  { id: "facebook", label: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp/" },
  { id: "twitch", label: "Twitch", url: "rtmp://live.twitch.tv/app" },
  { id: "custom", label: "Somewhere else", url: "" },
] as const;

export { StreamError };
