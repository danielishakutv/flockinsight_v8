import type { IngestKind } from "./tokens";

/**
 * How a capture tells it is still hearing the room, and what it says when it
 * was not.
 *
 * Two questions, both answered from raw numbers rather than a feeling:
 *
 *   IS THIS ADAPTER DEAD? The media server retries our endpoint for fifteen
 *   seconds after a disconnect and then closes the adapter for good, without
 *   telling us. An adapter it never connected at all looks, from here, exactly
 *   like one that is about to. Either way the voice is silent for the rest of
 *   the recording unless we notice and ask again.
 *
 *   DID THIS RECORDING CAPTURE ANYTHING? The encode is fed silence and the held
 *   picture on the wall clock whatever arrives, so a recording that heard
 *   nobody is still an hour-long file. Only the counts can tell it apart.
 *
 * Pure, so both rules can be tested without a media server.
 */

/**
 * An adapter with no socket, or a live microphone with no sound, for this long
 * is given up on and asked for again. Longer than the fifteen seconds the media
 * server spends retrying a lost endpoint, so a blip it recovers from by itself
 * is left alone.
 */
export const DEAD_ADAPTER_MS = 20_000;

/**
 * The window for an adapter whose last `streak` replacements all came up dead
 * without delivering a single packet: 20s, 40s, 80s, 160s, then 320s for good.
 *
 * Without it, a microphone the roster calls on but that sends nothing (a
 * publisher that has stopped, an ingest URL the media server cannot reach)
 * was replaced every twenty seconds for the rest of the meeting — a create
 * and a close against the media server each time, for every such voice, with
 * nothing to show for it. A replacement is still asked for at once; only the
 * wait before calling it dead grows. One packet resets the streak.
 */
export function deadWindowMs(streak: number, base = DEAD_ADAPTER_MS): number {
  return base * 2 ** Math.min(Math.max(0, streak), 4);
}

/**
 * The words the app's stalled sweep leaves on a server recording whose service
 * went quiet. Must match STALLED_RECORDER_GONE in src/lib/meetings.ts exactly —
 * health.test.ts reads that file to hold the two together. Copied rather than
 * imported because meetings.ts drags the whole app's server code into this
 * process.
 */
export const STALLED_RECORDER_MESSAGE =
  "The recording service stopped responding while this was being recorded. Whatever it captured before that is kept on the server; ask support to recover it.";

export type AdapterLinkState = {
  kind: IngestKind;
  adapterId: string | null;
  sockets: number;
  /** When the media server granted the adapter id. */
  createdAt: number;
  /** When the last socket went, while none has replaced it. */
  lostAt: number | null;
  /** When the current socket connected. */
  attachedAt: number;
  lastPacketAt: number;
  /** Since when the roster has said this microphone is on; null while muted. */
  micOnSince: number | null;
};

const secs = (ms: number) => Math.round(ms / 1000);

/** Why this adapter should be replaced, in words with the numbers in them — or null. */
export function deadAdapterReason(a: AdapterLinkState, now: number, deadMs = DEAD_ADAPTER_MS): string | null {
  if (a.adapterId && a.sockets === 0) {
    const since = a.lostAt ?? a.createdAt;
    if (now - since <= deadMs) return null;
    return a.lostAt === null
      ? `the media server never connected in the ${secs(now - a.createdAt)}s since it granted the adapter`
      : `its stream was lost ${secs(now - a.lostAt)}s ago and never came back`;
  }
  /*
   * A muted microphone still sends (the client keeps the track alive with
   * silence), but a mute is not judged here at all: only a microphone the
   * roster says is ON, measured from the later of its last packet, the moment
   * it was turned on, and the moment its socket connected — so an unmute
   * after a long quiet stretch gets the full grace before it is called dead.
   */
  if (a.kind === "mic" && a.sockets > 0 && a.micOnSince !== null) {
    const since = Math.max(a.lastPacketAt, a.micOnSince, a.attachedAt);
    if (now - since <= deadMs) return null;
    return a.lastPacketAt === 0
      ? `the microphone has been on for ${secs(now - since)}s and not one packet has arrived`
      : `the microphone is on but nothing has arrived for ${secs(now - since)}s`;
  }
  return null;
}

/** For /health: connected, never connected, or lost N s ago. */
export function describeLink(a: AdapterLinkState, now: number): string {
  if (a.sockets > 0) return "connected";
  if (a.lostAt !== null) return `lost ${secs(now - a.lostAt)}s ago`;
  return "never connected";
}

/* ============================================================
 * What a recording captured
 * ========================================================== */

export type CaptureCounts = {
  /** Microphone adapters asked for, counting every attempt. */
  micRequested: number;
  /** ...that the media server granted. */
  micGranted: number;
  micAttaches: number;
  audioPackets: number;
  audioBytes: number;
  videoGranted: number;
  videoAttaches: number;
  videoPackets: number;
  /** Real pictures taken from a camera or screen. */
  videoFrames: number;
  /** Off-camera placeholder frames, counted and never shown. */
  placeholderFrames: number;
  /** Adapters given up on as dead and asked for again. */
  adapterResets: number;
  /** The media server's last refusal, in its words. */
  lastRefusal: string | null;
};

export function emptyCounts(): CaptureCounts {
  return {
    micRequested: 0,
    micGranted: 0,
    micAttaches: 0,
    audioPackets: 0,
    audioBytes: 0,
    videoGranted: 0,
    videoAttaches: 0,
    videoPackets: 0,
    videoFrames: 0,
    placeholderFrames: 0,
    adapterResets: 0,
    lastRefusal: null,
  };
}

/** Earlier processes' counts plus this one's. */
export function mergeCounts(earlier: CaptureCounts, mine: CaptureCounts): CaptureCounts {
  const out = emptyCounts();
  for (const k of Object.keys(out) as (keyof CaptureCounts)[]) {
    if (k === "lastRefusal") continue;
    out[k] = (Number(earlier[k]) || 0) + (Number(mine[k]) || 0);
  }
  out.lastRefusal = mine.lastRefusal ?? earlier.lastRefusal;
  return out;
}

/**
 * Read `stats.json` back. `complete` says whether the counts cover every
 * segment on disk: a recording begun by a process that kept no counts has
 * segments nobody counted, and a verdict on those would be a guess.
 */
export function parseSavedStats(text: string): { counts: CaptureCounts; complete: boolean } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null; // a torn write from a crash; the caller treats it as missing
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { complete?: unknown; counts?: Record<string, unknown> };
  if (!r.counts || typeof r.counts !== "object") return null;
  const counts = emptyCounts();
  for (const k of Object.keys(counts) as (keyof CaptureCounts)[]) {
    if (k === "lastRefusal") continue;
    const v = Number(r.counts[k]);
    counts[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  counts.lastRefusal = typeof r.counts.lastRefusal === "string" ? r.counts.lastRefusal : null;
  return { counts, complete: r.complete === true };
}

export type CaptureVerdict =
  | { kind: "ok" }
  /** File it, but say this beside it. */
  | { kind: "note"; note: string }
  /** Do not file it: nothing was captured, and this says where it broke. */
  | { kind: "fail"; reason: string };

const streams = (n: number) => `${n} microphone stream${n === 1 ? " was" : "s were"}`;

export function captureVerdict(c: CaptureCounts): CaptureVerdict {
  if (c.audioPackets > 0) return { kind: "ok" };
  if (c.micRequested === 0) {
    return {
      kind: "note",
      note: "Nobody's microphone was on while this was being recorded, so there are no voices in it.",
    };
  }
  let why: string;
  if (c.micGranted === 0) {
    const last = c.lastRefusal ? ` (its last answer: ${c.lastRefusal})` : "";
    why = `Microphone streams were requested from the media server ${c.micRequested} time${c.micRequested === 1 ? "" : "s"} and it granted none of them${last}`;
  } else if (c.micAttaches === 0) {
    why = `${streams(c.micGranted)} requested from the media server and none of them ever connected`;
  } else {
    why = `${streams(c.micGranted)} requested and ${c.micAttaches} connection${c.micAttaches === 1 ? " was" : "s were"} made, but not one packet of sound arrived`;
  }
  /*
   * Real pictures from a camera or a shared screen are something captured,
   * sound or no sound. Failing the recording would throw them away, so it is
   * filed with the reason beside it instead.
   */
  if (c.videoFrames > 0) {
    return { kind: "note", note: `${why}, so there is no sound in this recording; the picture is kept.` };
  }
  return { kind: "fail", reason: `${why}, so nothing was captured.` };
}

/** 754 seconds as "12:34"; over an hour as "1:02:34". */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
