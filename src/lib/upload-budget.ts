/**
 * How much of someone's upload we may borrow for a recording, right now.
 *
 * The rule this encodes, and it is the only one that matters: **the meeting
 * always wins**. A recording is worth a great deal, but not at the cost of the
 * service it is a recording of. If sending it would make the meeting stutter
 * for everyone in the room, it waits — the file is safe on the device either
 * way, so waiting costs nothing but time.
 *
 * Pure, so the decision can be tested without a browser or a network. The
 * measurements come from the caller: WebRTC's own view of spare upload capacity
 * while a meeting is running, the Network Information API where it exists, and
 * what previous chunks actually achieved.
 */

export type UploadBudget = {
  /** May we send anything at all at this moment? */
  send: boolean;
  /**
   * Bytes per second to aim for, or null for "as fast as it goes".
   * A ceiling, not a target — the uploader paces itself under this.
   */
  limitBytesPerSecond: number | null;
  /** Plain words, for the UI and the log. Never a code. */
  reason: string;
};

export type NetworkSignals = {
  /** navigator.connection.effectiveType, where the browser offers it. */
  effectiveType?: string | null;
  /** navigator.connection.downlink, in Mbps. Downstream — a weak proxy only. */
  downlinkMbps?: number | null;
  /** The user asked the browser to save data. A preference, not a guess. */
  saveData?: boolean;
  /**
   * WebRTC's estimate of spare upstream, in bits per second, from the meeting's
   * own peer connection. The best signal there is, because it is measured on
   * the exact path the meeting is using — but only available during one.
   */
  availableOutgoingBitrate?: number | null;
  /** Fraction of outbound packets being lost, 0–1, from the same stats. */
  packetLoss?: number | null;
  /** Is a meeting running right now? */
  inMeeting: boolean;
  /** What recent chunks actually achieved, bytes/sec. */
  observedBytesPerSecond?: number | null;
};

/**
 * The share of measured spare capacity a recording may use during a meeting.
 *
 * A quarter, deliberately. WebRTC's estimate is optimistic — it is what the
 * connection managed, not what it will keep managing — and the cost of being
 * wrong is asymmetric: too conservative delays a file nobody is waiting for,
 * too aggressive breaks a live service.
 */
const MEETING_SHARE = 0.25;

/**
 * Below this there is no point trying mid-meeting. 32 KB/s is slower than the
 * recording is being produced, so it would never catch up and would spend the
 * whole service competing with the video for nothing.
 */
const MIN_USEFUL_BYTES_PER_SECOND = 32 * 1024;

/** Loss above this means the connection is already struggling. Stop helping. */
const LOSS_CEILING = 0.03;

export function uploadBudget(signals: NetworkSignals): UploadBudget {
  const {
    effectiveType,
    saveData,
    availableOutgoingBitrate,
    packetLoss,
    inMeeting,
  } = signals;

  // An explicit instruction from the person, not an inference about them.
  if (saveData) {
    return inMeeting
      ? { send: false, limitBytesPerSecond: null, reason: "Data saver is on — waiting until the meeting ends." }
      : { send: true, limitBytesPerSecond: 64 * 1024, reason: "Data saver is on — uploading slowly." };
  }

  /*
   * 2G, in or out of a meeting. Trying here does not fail politely: it occupies
   * the connection for minutes at a time and makes everything else worse.
   */
  if (effectiveType === "slow-2g" || effectiveType === "2g") {
    return {
      send: false,
      limitBytesPerSecond: null,
      reason: "The connection is too weak to upload right now — it will go up when it improves.",
    };
  }

  if (!inMeeting) {
    // Nothing to protect. Go as fast as the connection allows, except on 3G
    // where a flat-out upload makes the rest of the app unusable.
    if (effectiveType === "3g")
      return { send: true, limitBytesPerSecond: 128 * 1024, reason: "Uploading gently on a 3G connection." };
    return {
      send: true,
      limitBytesPerSecond: null,
      reason: "Uploading the recording in the background.",
    };
  }

  /* ---- A meeting is running. Everything below protects it. ---- */

  if (packetLoss != null && packetLoss > LOSS_CEILING) {
    return {
      send: false,
      limitBytesPerSecond: null,
      reason: "The meeting is already losing packets — holding the recording back.",
    };
  }

  /*
   * No estimate means no evidence, and during a meeting the safe reading of no
   * evidence is "do not". The recording is on the device and loses nothing by
   * waiting for the call to end.
   */
  if (availableOutgoingBitrate == null) {
    return {
      send: false,
      limitBytesPerSecond: null,
      reason: "Waiting until the meeting ends, so the call keeps the bandwidth.",
    };
  }

  const spareBytes = (availableOutgoingBitrate / 8) * MEETING_SHARE;
  if (spareBytes < MIN_USEFUL_BYTES_PER_SECOND) {
    return {
      send: false,
      limitBytesPerSecond: null,
      reason: "Not enough spare connection during the meeting — it will upload afterwards.",
    };
  }

  return {
    send: true,
    limitBytesPerSecond: Math.floor(spareBytes),
    reason: "Uploading in the background, using only spare connection.",
  };
}

/**
 * How long to wait before sending the next chunk, to stay under a limit.
 *
 * Paced by waiting rather than by throttling the socket, because a browser
 * cannot throttle a fetch — but it can decide when to start the next one.
 */
export function pauseAfterChunk(
  chunkBytes: number,
  tookMs: number,
  limitBytesPerSecond: number | null,
): number {
  if (!limitBytesPerSecond || limitBytesPerSecond <= 0) return 0;
  const owedMs = (chunkBytes / limitBytesPerSecond) * 1000;
  return Math.max(0, Math.round(owedMs - tookMs));
}

/** Read what the browser will tell us about the connection. Browser only. */
export function readNetworkSignals(): Pick<
  NetworkSignals,
  "effectiveType" | "downlinkMbps" | "saveData"
> {
  if (typeof navigator === "undefined") return {};
  const c = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
    }
  ).connection;
  if (!c) return {};
  return {
    effectiveType: c.effectiveType ?? null,
    downlinkMbps: c.downlink ?? null,
    saveData: c.saveData ?? false,
  };
}
