import {
  audioWireBitrate,
  TRACK_NAMES,
  tuneOpus,
  type AudioProfile,
  type RosterEntry,
} from "@/lib/meetings-shared";

/**
 * The SFU transport — the browser half.
 *
 * Deliberately a separate object from `MeetingClient` rather than a rewrite of
 * it. Everything that makes a meeting a meeting — signalling, the roster, chat,
 * reactions, the stage, recording, presence — is the same whichever way media
 * travels, and all of it already works. Only the media plumbing differs, so
 * only the media plumbing is duplicated, and the mesh path is not touched at
 * all by any of this.
 *
 * TWO CONNECTIONS, and the reason matters. A publisher (sendonly) carries this
 * person's own tracks; a subscriber (recvonly) carries everybody else's. One
 * connection would mean that somebody switching their camera on renegotiates
 * the same connection that is delivering the sermon to them. Two means those
 * two events cannot interfere.
 *
 * TWO QUEUES, for the same reason. Each session must be mutated one change at
 * a time — Cloudflare answers a second concurrent change with a 406 — but the
 * two sessions are independent. The publish and the first pull run side by
 * side.
 *
 * NO GUESSING WHICH TRACK IS WHOSE. Every pull returns the `mid` the SFU
 * allocated, so `mid -> (peerId, kind)` is recorded from the answer and
 * `ontrack` is a lookup. There is no fallback, because there is nothing to
 * fall back to.
 *
 * FOUR RULES OF THE MEDIA SERVER, each measured against the real one on
 * 2026-10-21 (a headless browser and a timed proxy, not a reading of the docs
 * alone), and each the cause of somebody not being heard:
 *
 *   1. A session that is created and then left idle dies. Fifteen seconds
 *      after `sessions/new`, the first pull on it was held 5.6s and refused
 *      410. Sessions used to be minted the moment a room was joined, so the
 *      first person to arrive found the host's subscriber already dead — and
 *      three such refusals were waited out before it was replaced. That was
 *      most of "it takes forever to hear people the first time". Now the
 *      first publish and the first pull create their session in the same
 *      request, so no session is ever idle.
 *
 *   2. A published track that carries no packets for thirty seconds is
 *      deleted. A camera turned off by swapping its track for null was gone
 *      for good forty seconds later, and turning it back on showed nobody
 *      anything. A camera or screen that is off now sends a one-frame-a-second
 *      black placeholder, which keeps the publication alive (measured), and a
 *      track that was nonetheless idle past the limit is published afresh.
 *
 *   3. A pull that includes a track with no media is held for eight and a half
 *      seconds before answering `empty_track_error` — and every OTHER track in
 *      the same request waits with it. One silent camera in a batch made the
 *      whole room's voices arrive 8.5s late. Voices are now pulled before
 *      pictures, and a track that has failed once is retried on its own.
 *
 *   4. A call whose answer was lost leaves the session in a state nothing can
 *      repair: the media server may have made the change, may be waiting for
 *      an answer that will never come, and refuses every later pull with
 *      "renegotiation is expected". The only recovery is a new session, which
 *      is what happens now, at once, rather than after the session had been
 *      refused for the rest of the meeting.
 */

export type SfuEvents = {
  /** A peer's media changed: new tracks, or a track that stopped. */
  onMedia: (peerId: string, media: { stream: MediaStream; screen: MediaStream }) => void;
  /** A peer left, or stopped publishing entirely. */
  onGone: (peerId: string) => void;
  /** Connection health, for the same pill the mesh drives. */
  onState: (state: RTCPeerConnectionState) => void;
  onError: (message: string) => void;
};

type Api = (action: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * A refusal from `/api/meet/<code>/sfu`, carrying what the route knew.
 *
 * The status and the media server's own error code are what decide whether a
 * session can go on being used. A bare message could not tell "this session is
 * finished" from "try again in a second".
 */
export class SfuApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** The outcome is unknown: a timeout, or the media server failing. */
    readonly uncertain: boolean,
  ) {
    super(message);
    this.name = "SfuApiError";
  }
}

/**
 * What a failed call means for the session it was made on.
 *
 *   gone       the session is finished (410). Retrying it never reconnects it.
 *   wedged     the offer/answer order is broken; nothing later will be accepted.
 *   uncertain  the change may or may not have happened. Cloudflare's guidance,
 *              and the only safe reading, is to replace the connection.
 *   early      the transport is still coming up (425). Ask again shortly.
 *   refused    our own route said no (gone from the room, still in the lobby).
 *              Nothing about the session is wrong.
 */
export type SfuFailure = "gone" | "wedged" | "uncertain" | "early" | "refused";

export function classifySfuError(e: unknown): SfuFailure {
  const status = e instanceof SfuApiError ? e.status : 0;
  const code = e instanceof SfuApiError ? e.code : null;
  const message = e instanceof Error ? e.message : String(e);
  if (status === 425) return "early";
  if (code === "session_error" || status === 410 || /disconnected|not connected/i.test(message)) {
    return "gone";
  }
  if (
    code === "invalid_session_description" ||
    status === 406 ||
    /signaling state|renegotiation is expected|out-of-order/i.test(message)
  ) {
    return "wedged";
  }
  if (
    (e instanceof SfuApiError && e.uncertain) ||
    status >= 500 ||
    (status === 0 && /reach|timeout|timed out|aborted|network|failed to fetch|load failed/i.test(message))
  ) {
    return "uncertain";
  }
  return "refused";
}

/**
 * Attempts at one track at the quick cadence before dropping to the slow one.
 *
 * A track that is not published yet appears within a second or two, which is
 * what the quick retries are for. One that takes longer — a phone whose
 * microphone dialog sat unanswered for a minute — is still asked for, just
 * every SLOW_RETRY_MS.
 */
const PULL_ATTEMPTS = 6;
const PULL_BACKOFF_MAX_MS = 8_000;
const SLOW_RETRY_MS = 20_000;
/**
 * A track the media server held and then reported as carrying no media. Each
 * such attempt costs the subscriber queue eight and a half seconds, so it is
 * not asked for again in a hurry.
 */
const EMPTY_TRACK_RETRY_MS = 6_000;
/** How soon after a refused pull the next one is tried. */
const RETRY_SOON_MS = 1_500;
/** How often the transport re-checks for work it has not finished, between polls. */
const RETRY_TICK_MS = 1_000;
/** Cloudflare takes up to 64 tracks a request; a room never needs that many at once. */
const MAX_BATCH = 32;
/**
 * How long to gather candidates before handing a description to the SFU.
 *
 * The media server is a lite ICE agent on anycast addresses: it answers
 * connectivity checks from wherever we turn out to be and never makes any of
 * its own, so the candidates in our description matter far less than the
 * checks we run afterwards. One public address is enough to begin; the rest
 * are given a moment to land, and the whole wait is capped.
 */
const GATHER_SETTLE_MS = 350;
const GATHER_CAP_MS = 2_500;
/** How long a pull waits for our own transport to come up before asking. */
const CONNECT_WAIT_MS = 5_000;
/** How long a connection may sit "disconnected" before it is replaced. */
const DISCONNECTED_GRACE_MS = 10_000;
/**
 * How long a published track may carry nothing before it is treated as gone.
 * The media server's limit is thirty seconds; this leaves room for the
 * publish itself.
 */
const PUBLICATION_IDLE_LIMIT_MS = 25_000;
/** How often the off-camera placeholder paints. Cheap, and well inside the limit. */
const PLACEHOLDER_PAINT_MS = 1_000;
/** Samples (4s apart) with no bytes on a track the roster says is on, before re-pulling it. */
const STALE_SAMPLES = 3;

type PulledTrack = { peerId: string; name: string; sessionId: string };

/** One person's connection, as the subscriber sees it. */
export type SfuPeerReading = {
  videoInKbps: number;
  framesDecoded: number;
  ice: RTCIceConnectionState;
  audioInKbps: number;
  audioLossPct: number;
  audioConcealedPct: number;
  audioJitterMs: number;
  audioJitterBufferMs: number;
  /**
   * How long after this person first appeared in the roster their voice
   * first arrived here, in milliseconds. Null until it has. This is the
   * number behind "it takes forever to hear a new person", measured.
   */
  heardAfterMs: number | null;
};

/** What we are currently sending, so a change can be compared against it. */
type Published = { mic?: string; cam?: string; screen?: string };

type Want = { key: string; peerId: string; name: string; sessionId: string; retry: boolean };

export class SfuTransport {
  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;

  private publisherSession: string | null = null;
  private subscriberSession: string | null = null;
  /** The route's proof that each session was minted for this participant. */
  private publisherProof = "";
  private subscriberProof = "";
  /** Mids the media server sent that nothing here asked for; see `closeOrphans`. */
  private orphans = new Set<string>();
  /** Mids already handed back, which a later description may still list. */
  private handedBack = new Set<string>();
  private orphanTries = new Map<string, number>();

  /** Our own sendonly transceivers, by track name. */
  private senders = new Map<string, RTCRtpTransceiver>();
  private published: Published = {};
  /** When each sender last had nothing real to send, if it has nothing now. */
  private idleSince = new Map<string, number>();
  /** The off-camera picture, one per sender that needs it. */
  private placeholders = new Map<string, { track: MediaStreamTrack; timer: ReturnType<typeof setInterval> }>();

  /** `mid` -> whose track it is. Filled in from the SFU's own answer. */
  private incoming = new Map<string, PulledTrack>();
  /** What we have already asked for, so a poll does not re-pull every tick. */
  private pulled = new Set<string>();
  /** Which session each pulled track came from, so a rebuilt publisher is noticed. */
  private pulledFrom = new Map<string, string>();
  /** Failed attempts per track, and when the next one may be made. */
  private pullTries = new Map<string, number>();
  private pullAfter = new Map<string, number>();

  /** When each peer was first named in the roster, and when first heard. */
  private firstSeen = new Map<string, number>();
  private heardAfter = new Map<string, number>();
  /** First-heard timings not yet reported to the server. */
  private heardQueue: string[] = [];
  private heardTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-peer media, assembled as tracks arrive. */
  private media = new Map<string, { stream: MediaStream; screen: MediaStream }>();

  /** Previous byte totals per peer, for turning them into a rate. */
  private lastVideoBytes = new Map<string, { at: number; bytes: number; still: number }>();
  /**
   * Previous audio counters per peer, so loss and concealment can be reported
   * for the window just gone rather than for the whole call.
   */
  private lastAudio = new Map<
    string,
    {
      at: number;
      bytes: number;
      still: number;
      packetsReceived: number;
      packetsLost: number;
      concealedSamples: number;
      totalSamples: number;
    }
  >();
  /** Whether this browser has been found to refuse a jitter buffer hint. */
  private jitterBufferRefused = false;

  /**
   * Whose PICTURES are wanted right now — the people on screen.
   *
   * Voices are pulled from everybody regardless; a meeting where you cannot
   * hear somebody is not a meeting, and audio is 24 kbps. Video is the
   * expensive half, and pulling all of it is what made download grow with the
   * room.
   *
   * Null means "not told yet", which is treated as wanting everything — the
   * safe direction, because a room that shows nothing is worse than a room
   * that costs too much for a few seconds.
   */
  private videoInterest: Set<string> | null = null;

  private pubChain: Promise<unknown> = Promise.resolve();
  private subChain: Promise<unknown> = Promise.resolve();
  private stopped = false;

  /** The last roster seen, so a retry can run without waiting for a poll. */
  private lastRoster: RosterEntry[] = [];
  private myPeerId = "";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * What this person last asked to send, so the transport can publish it
   * again by itself. Without it a publisher that failed waited for the next
   * `setLocal` — which only comes when somebody touches the mic or camera
   * button, so a person who simply sat and talked was mute for the rest of
   * the meeting.
   */
  private lastLocal: { mic: MediaStreamTrack | null; camera: MediaStreamTrack | null; screen: MediaStreamTrack | null } | null = null;
  private republishTimer: ReturnType<typeof setTimeout> | null = null;
  private republishAttempts = 0;
  /** When each connection was last replaced, to keep replacements from storming. */
  private subRebuilds: number[] = [];
  /**
   * Bumped whenever a connection is replaced. A connection-state handler can
   * replace one while a pull or publish is half way through on it; that work
   * checks this after every wait and stands down rather than writing into the
   * replacement.
   */
  private subGeneration = 0;
  private pubGeneration = 0;
  /** First pulls in a row that could not create a session; backs the retry off. */
  private firstPullFailures = 0;
  private disconnectTimers: { pub: ReturnType<typeof setTimeout> | null; sub: ReturnType<typeof setTimeout> | null } = {
    pub: null,
    sub: null,
  };

  constructor(
    private readonly api: Api,
    private readonly iceServers: RTCIceServer[],
    /**
     * The voice settings in force right now, read rather than held.
     *
     * A function because the profile follows the measured link and this object
     * may negotiate at any point after it was built. An SFU room gets the Opus
     * tuning, the sender priority and the jitter buffer; it does not get RED,
     * because toggling that means renegotiating a Cloudflare session over a
     * codec preference and the three it does get are most of the benefit.
     */
    private readonly audio: () => AudioProfile,
    private readonly events: SfuEvents,
  ) {}

  /** The shape this transport negotiates with: never redundant. See above. */
  private audioShape(): AudioProfile {
    return { ...this.audio(), redundancy: false };
  }

  /**
   * Hold some audio back before playing it, and let the voice outrank the
   * pictures on the way out.
   *
   * The same two things the mesh path does, for the same reason — a player
   * with an empty buffer invents every gap in a gusty link, and a camera that
   * is allowed to compete with a microphone for a thin uplink wins. Neither
   * costs any bandwidth. See `tuneAudioReceiver` in meeting-client.ts.
   */
  tuneAudio(): void {
    const target = this.audioShape().jitterBufferMs;

    for (const tr of this.subscriber?.getTransceivers() ?? []) {
      const who = tr.mid ? this.incoming.get(tr.mid) : undefined;
      if (who && who.name !== TRACK_NAMES.mic) continue;
      const r = tr.receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number | null;
        playoutDelayHint?: number | null;
      };
      try {
        if ("jitterBufferTarget" in r) r.jitterBufferTarget = target;
        if ("playoutDelayHint" in r) r.playoutDelayHint = target / 1000;
      } catch (e) {
        if (!this.jitterBufferRefused) {
          this.jitterBufferRefused = true;
          console.warn("[sfu] this browser refused a jitter buffer hint", e);
        }
      }
    }

    const mic = this.senders.get(TRACK_NAMES.mic)?.sender;
    if (!mic) return;
    try {
      const params = mic.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = audioWireBitrate(this.audioShape());
      params.encodings[0].priority = "high";
      params.encodings[0].networkPriority = "high";
      void mic.setParameters(params).catch((e) => {
        console.warn("[sfu] microphone parameters refused", e);
      });
    } catch (e) {
      console.warn("[sfu] microphone parameters could not be read", e);
    }
  }

  /**
   * Serialise every mutation of ONE session.
   *
   * Cloudflare answers a second concurrent change to one session with a 406,
   * and the moment that happens is a room where several people join together —
   * precisely when a meeting must not break. A promise chain per session is
   * enough because each session is mutated only from this object; and it is
   * one chain PER SESSION, so publishing never queues behind subscribing.
   */
  private queue<T>(which: "pub" | "sub", work: () => Promise<T>): Promise<T> {
    const chain = which === "pub" ? this.pubChain : this.subChain;
    const next = chain.then(work, work);
    // Keep the chain alive after a failure: one bad pull must not stop every
    // later one from being attempted.
    const kept = next.catch(() => undefined);
    if (which === "pub") this.pubChain = kept;
    else this.subChain = kept;
    return next;
  }

  private pc(): RTCPeerConnection {
    return new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
  }

  /**
   * Replace a connection that has stopped working.
   *
   * "failed" at once. "disconnected" after a grace period: a network handover
   * (wifi to mobile data) usually lands there and never comes back by itself,
   * because nothing here restarts ICE — and a replacement is a second or two,
   * where waiting for the browser to give up is thirty.
   */
  private watch(pc: RTCPeerConnection, which: "pub" | "sub"): void {
    pc.onconnectionstatechange = () => {
      const current = which === "pub" ? this.publisher : this.subscriber;
      if (pc !== current || this.stopped) return;
      const state = pc.connectionState;
      if (which === "pub") this.events.onState(state);

      const pending = this.disconnectTimers[which];
      if (state !== "disconnected" && pending) {
        clearTimeout(pending);
        this.disconnectTimers[which] = null;
      }

      if (state === "connected" && which === "pub") this.republishAttempts = 0;
      if (state === "failed") {
        if (which === "pub") this.failPublisher("the publishing connection failed");
        else this.rebuildSubscriber("the subscribing connection failed");
        return;
      }
      if (state === "disconnected" && !this.disconnectTimers[which]) {
        this.disconnectTimers[which] = setTimeout(() => {
          this.disconnectTimers[which] = null;
          const still = which === "pub" ? this.publisher : this.subscriber;
          if (still !== pc || pc.connectionState !== "disconnected") return;
          if (which === "pub") this.failPublisher("the publishing connection stayed disconnected");
          else this.rebuildSubscriber("the subscribing connection stayed disconnected");
        }, DISCONNECTED_GRACE_MS);
      }
    };
  }

  /**
   * Wait for enough candidates to hand an SDP to the SFU.
   *
   * Cloudflare's API takes one description rather than a stream of candidates,
   * so a description sent with none is a description with no way to connect.
   * But it is a lite agent: it never dials us, it only answers the checks we
   * run, from whichever of our addresses they arrive. So this waits for the
   * first public address (server-reflexive or relayed), gives the rest a
   * moment to land, and goes — capped, because a network that never finishes
   * gathering would otherwise hang the join.
   */
  private async gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      let settle: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", onState);
        pc.removeEventListener("icecandidate", onCandidate);
        if (settle) clearTimeout(settle);
        clearTimeout(cap);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const onCandidate = (e: Event) => {
        const c = (e as RTCPeerConnectionIceEvent).candidate;
        if (!c) {
          done();
          return;
        }
        const type = (c as RTCIceCandidate & { type?: string }).type;
        if ((type === "srflx" || type === "relay") && !settle) {
          settle = setTimeout(done, GATHER_SETTLE_MS);
        }
      };
      pc.addEventListener("icegatheringstatechange", onState);
      pc.addEventListener("icecandidate", onCandidate);
      const cap = setTimeout(done, GATHER_CAP_MS);
    });
  }

  /**
   * Wait for a connection to come up, briefly.
   *
   * The media server waits up to five seconds for a session's transport before
   * acting on anything that needs it. Waiting here instead keeps that time off
   * the request, and off everything queued behind it.
   */
  private connected(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
    const up = () => pc.connectionState === "connected";
    if (up()) return Promise.resolve(true);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        pc.removeEventListener("connectionstatechange", onChange);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => {
        if (up()) done(true);
        else if (pc.connectionState === "failed" || pc.connectionState === "closed") done(false);
      };
      pc.addEventListener("connectionstatechange", onChange);
      const timer = setTimeout(() => done(up()), timeoutMs);
    });
  }

  /**
   * Tell the server what the transport just had to do.
   *
   * Everything in this file happens in somebody's browser, where no log of ours
   * can see it. A replaced connection or a voice that took nine seconds to
   * arrive is exactly what has to be visible the morning after a service, so
   * it is reported — one short line, rate-limited on the server.
   */
  private report(kind: string, detail: string): void {
    if (this.stopped) return;
    this.api("event", { kind, detail: detail.slice(0, 300) }).catch((e: unknown) => {
      console.warn(`[sfu] could not report "${kind}" to the server`, e);
    });
  }

  /* ============================================================
   * Publishing
   * ========================================================== */

  /**
   * A black picture at one frame a second, sent while a camera or screen is
   * off.
   *
   * Sending nothing is what the media server deletes a publication for (rule
   * 2 above). This keeps it alive for roughly a kilobit a second, and the
   * camera itself is still released — the indicator light goes out, which is
   * what people rightly read as no longer being watched. The canvas is
   * repainted on a timer because a canvas that does not change produces no
   * frames at all.
   *
   * Null where a canvas cannot be captured; the idle-limit check in
   * `publishWork` covers that case by publishing afresh instead.
   */
  private placeholder(name: string): MediaStreamTrack | null {
    const existing = this.placeholders.get(name);
    if (existing && existing.track.readyState === "live") return existing.track;
    if (typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 36;
      const g = canvas.getContext("2d");
      if (!g || typeof canvas.captureStream !== "function") return null;
      let flip = false;
      const paint = () => {
        g.fillStyle = flip ? "#000000" : "#010101";
        flip = !flip;
        g.fillRect(0, 0, canvas.width, canvas.height);
      };
      paint();
      const track = canvas.captureStream(1).getVideoTracks()[0];
      if (!track) return null;
      const timer = setInterval(paint, PLACEHOLDER_PAINT_MS);
      this.placeholders.set(name, { track, timer });
      return track;
    } catch (e) {
      console.warn("[sfu] could not make an off-camera placeholder", e);
      return null;
    }
  }

  private stopPlaceholders(): void {
    for (const { track, timer } of this.placeholders.values()) {
      clearInterval(timer);
      track.stop();
    }
    this.placeholders.clear();
  }

  /**
   * Send these tracks, replacing whatever was being sent before.
   *
   * A track that is already published is swapped with `replaceTrack`, which
   * needs no renegotiation at all — so turning a camera on and off in a room
   * of two hundred costs one local operation and nothing on the wire.
   *
   * Never throws: a publish that fails is torn down and tried again on a
   * backoff, because nothing else would ever try it again.
   */
  async setLocal(tracks: {
    mic: MediaStreamTrack | null;
    camera: MediaStreamTrack | null;
    screen: MediaStreamTrack | null;
  }): Promise<void> {
    this.lastLocal = tracks;
    await this.queue("pub", async () => {
      if (this.stopped) return;
      try {
        await this.publishWork(tracks);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.failPublisher(`publishing failed (${classifySfuError(e)}): ${message}`);
      }
    });
  }

  private async publishWork(tracks: {
    mic: MediaStreamTrack | null;
    camera: MediaStreamTrack | null;
    screen: MediaStreamTrack | null;
  }): Promise<void> {
    const wanted: [keyof Published, string, MediaStreamTrack | null][] = [
      ["mic", TRACK_NAMES.mic, tracks.mic],
      ["cam", TRACK_NAMES.camera, tracks.camera],
      ["screen", TRACK_NAMES.screen, tracks.screen],
    ];

    /*
     * A sender that has been sending nothing for longer than the media server
     * keeps a silent publication cannot simply be given its track back: the
     * publication is gone, and everybody's subscription to it with it. Start
     * the publisher again instead. The roster then carries a new session id,
     * and every subscriber pulls this person afresh (`reclaimRepublished`).
     */
    const now = Date.now();
    const expired = wanted.some(([, name, track]) => {
      const since = this.idleSince.get(name);
      return !!track && this.senders.has(name) && since !== undefined && now - since > PUBLICATION_IDLE_LIMIT_MS;
    });
    if (expired && this.publisher) {
      this.report("publisher-renewed", "a track idle past the media server's limit came back");
      this.discardPublisher();
    }

    if (!this.publisher) {
      this.publisher = this.pc();
      this.watch(this.publisher, "pub");
    }
    const pc = this.publisher;
    const generation = this.pubGeneration;
    /** Whether this work is still about the connection it started on. */
    const current = () => !this.stopped && generation === this.pubGeneration && this.publisher === pc;

    const fresh: { trackName: string }[] = [];

    for (const [key, name, track] of wanted) {
      const existing = this.senders.get(name);
      if (existing) {
        // Already negotiated: a swap, and no SDP. A camera or screen that goes
        // off is given the placeholder rather than nothing (rule 2).
        const sending = track ?? (name === TRACK_NAMES.mic ? null : this.placeholder(name));
        await existing.sender.replaceTrack(sending);
        if (sending) this.idleSince.delete(name);
        else if (!this.idleSince.has(name)) this.idleSince.set(name, Date.now());
        continue;
      }
      if (!track) continue;

      const tr = pc.addTransceiver(track, { direction: "sendonly" });
      this.senders.set(name, tr);
      this.published[key] = name;
      this.idleSince.delete(name);
      fresh.push({ trackName: name });
    }

    if (fresh.length === 0 || !current()) return;

    const offer = await pc.createOffer();
    // Our own description is what this end sends with, so the voice is tuned
    // here or not at all.
    if (offer.sdp) offer.sdp = tuneOpus(offer.sdp, this.audioShape());
    await pc.setLocalDescription(offer);
    await this.gathered(pc);
    if (!current()) return;

    // Mids only exist after setLocalDescription, which is why they are read
    // here rather than when the transceiver was created.
    const payload = fresh
      .map((f) => ({
        mid: this.senders.get(f.trackName)?.mid ?? "",
        trackName: f.trackName,
      }))
      .filter((f) => f.mid);

    /*
     * The first publish creates the session in the same request (rule 1):
     * the route mints it, publishes into it and hands back its id with the
     * proof that it is ours.
     */
    const res = await this.api("publish", {
      session: this.publisherSession ?? undefined,
      proof: this.publisherProof || undefined,
      sdp: {
        type: "offer",
        sdp: pc.localDescription?.sdp ?? "",
      },
      tracks: payload,
    });
    // Replaced while the request was out: the replacement publishes for itself.
    if (!current()) return;

    if (!this.publisherSession) {
      if (typeof res.sessionId !== "string") throw new Error("The media server gave no session.");
      this.publisherSession = res.sessionId;
      this.publisherProof = typeof res.proof === "string" ? res.proof : "";
    }

    const answer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
    if (!answer?.sdp) throw new Error("The media server sent no answer to our offer.");
    await pc.setRemoteDescription(answer);
    this.tuneAudio();
  }

  /* ============================================================
   * Subscribing
   * ========================================================== */

  /**
   * Say who is on screen. Anyone dropping out of this set has their video
   * closed; anyone entering it has theirs pulled on the next sync.
   *
   * Audio is deliberately not part of this.
   */
  setVideoInterest(peerIds: Iterable<string>): void {
    this.videoInterest = new Set(peerIds);
  }

  /** Is this person's picture wanted? Unset means "we have not been told yet". */
  private wantsVideoFrom(peerId: string): boolean {
    return this.videoInterest === null || this.videoInterest.has(peerId);
  }

  /** Which of somebody's tracks are worth asking for, given what we hold. */
  private available(r: RosterEntry): string[] {
    /*
     * Only what they have actually published, which the roster states.
     *
     * A track exists on the SFU from the moment it is first turned on, and —
     * now that an idle camera sends a placeholder — survives being turned off
     * afterwards. So these flags are the right question to ask: they go true
     * the moment there is something to pull.
     *
     * Asking for all three unconditionally is what broke this once. People
     * join with their camera off, so at that instant only the microphone
     * exists; the other two came back as per-track errors that nothing
     * looked at, were marked done anyway, and were never asked for again.
     */
    const names: string[] = [];
    if (r.micOn || this.pulled.has(`${r.peerId}:${TRACK_NAMES.mic}`)) {
      names.push(TRACK_NAMES.mic);
    }
    // Their picture, only if it is being looked at. This one condition is
    // what turns download from linear in room size into flat.
    if (r.cameraOn && this.wantsVideoFrom(r.peerId)) names.push(TRACK_NAMES.camera);
    // A shared screen is always wanted: somebody sharing is, by definition,
    // the thing the room is looking at.
    if (r.sharing) names.push(TRACK_NAMES.screen);
    return names;
  }

  private others(roster: RosterEntry[], myPeerId: string): RosterEntry[] {
    return roster.filter((r) => r.admitted && r.peerId !== myPeerId && r.sfuSessionId);
  }

  /** Is there anything wanted that has not arrived? Drives the retry tick. */
  private pendingWork(): boolean {
    for (const r of this.others(this.lastRoster, this.myPeerId)) {
      for (const name of this.available(r)) {
        if (!this.pulled.has(`${r.peerId}:${name}`)) return true;
      }
    }
    return false;
  }

  /** Is any of that work allowed to go right now, rather than after a backoff? */
  private dueWork(): boolean {
    const now = Date.now();
    for (const r of this.others(this.lastRoster, this.myPeerId)) {
      for (const name of this.available(r)) {
        const key = `${r.peerId}:${name}`;
        if (!this.pulled.has(key) && now >= (this.pullAfter.get(key) ?? 0)) return true;
      }
    }
    return false;
  }

  /**
   * Look again soon, without waiting for a poll to return.
   *
   * Every pull used to be driven by the roster arriving, and the roster
   * arrives when the long-poll returns — which, in a quiet room, is when its
   * hold expires. This is the second chance, on a timer of its own, for as
   * long as something is still wanted.
   */
  private scheduleRetry(ms: number): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped || !this.pendingWork()) return;
      void this.sync(this.lastRoster, this.myPeerId).catch((e) => {
        console.error("[sfu] retry failed", e);
      });
    }, ms);
  }

  /**
   * Try a refused pull again soon. A first pull — the one that creates the
   * session — backs off as it keeps failing, because a media server that is
   * down would otherwise be asked every second and a half by every person in
   * the room for as long as it stayed down.
   */
  private retryFirstPull(creating: boolean): void {
    if (!creating) {
      this.scheduleRetry(RETRY_SOON_MS);
      return;
    }
    this.firstPullFailures += 1;
    this.scheduleRetry(Math.min(15_000, RETRY_SOON_MS * 2 ** (this.firstPullFailures - 1)));
  }

  /** After a pull: straight on if more is due now, otherwise on the tick. */
  private continueSoon(): void {
    if (!this.pendingWork()) return;
    this.scheduleRetry(this.dueWork() ? 0 : RETRY_TICK_MS);
  }

  /**
   * What to ask for in the next request.
   *
   * Voices before pictures, in separate requests, so a camera the media
   * server has to wait for can never delay a voice (rule 3). And a track that
   * has failed before goes on its own: it is the likeliest to be held, and
   * every other track in its request would be held with it.
   */
  private nextBatch(wants: Want[]): Want[] {
    const voices = wants.filter((w) => w.name === TRACK_NAMES.mic);
    const lane = voices.length > 0 ? voices : wants;
    const firstTime = lane.filter((w) => !w.retry);
    return firstTime.length > 0 ? firstTime.slice(0, MAX_BATCH) : lane.slice(0, 1);
  }

  /**
   * Pull whatever is new in the roster, and drop whoever has gone.
   *
   * Driven by the same poll that already keeps the roster current, so there is
   * no second source of truth about who is in the room. Only tracks not
   * already pulled are asked for, which is what keeps a four-second poll from
   * renegotiating four times a second.
   */
  async sync(roster: RosterEntry[], myPeerId: string): Promise<void> {
    this.lastRoster = roster;
    this.myPeerId = myPeerId;
    const now = Date.now();
    for (const r of roster) {
      if (r.admitted && r.peerId !== myPeerId && !this.firstSeen.has(r.peerId)) {
        this.firstSeen.set(r.peerId, now);
      }
    }

    await this.queue("sub", async () => {
      if (this.stopped) return;
      const generation = this.subGeneration;
      /** Whether this work is still about the session it started on. */
      const current = () => !this.stopped && generation === this.subGeneration;

      const others = this.others(roster, myPeerId);
      const live = new Set(others.map((r) => r.peerId));

      for (const [peerId] of this.media) {
        if (!live.has(peerId)) {
          this.media.delete(peerId);
          this.events.onGone(peerId);
        }
      }

      // Forget what we pulled from anybody who has gone. Otherwise the same
      // person rejoining — a reload, a dropped connection — finds their tracks
      // already recorded as pulled, against a session that no longer exists,
      // and never appears again.
      for (const key of [...this.pulled]) {
        const peerId = key.slice(0, key.lastIndexOf(":"));
        if (!live.has(peerId)) this.pulled.delete(key);
      }
      for (const peerId of [...this.firstSeen.keys()]) {
        if (!roster.some((r) => r.peerId === peerId)) {
          this.firstSeen.delete(peerId);
          this.heardAfter.delete(peerId);
        }
      }

      /*
       * And HAND BACK what they were arriving on.
       *
       * Forgetting a departed peer locally was not the same as letting go of
       * them, and the difference is what made a long meeting fall over. Every
       * voice is pulled onto the one subscriber session, so a peer who left
       * used to leave their transceiver, its decoder and its jitter buffer
       * behind for the rest of the meeting. That cost grows with CHURN rather
       * than with the size of the room — `meeting-sfu-churn.test.ts` holds the
       * arithmetic.
       */
      await this.reclaimDeparted(live);
      await this.reclaimRepublished(others);
      await this.dropUnwatched(live);
      // Any of those may have found the session finished and replaced it; the
      // replacement's own retry pulls the room.
      if (!current()) return;

      const wants: Want[] = [];
      for (const r of others) {
        for (const name of this.available(r)) {
          const key = `${r.peerId}:${name}`;
          if (this.pulled.has(key)) continue;
          /*
           * Backed off, because a track that cannot be pulled used to be asked
           * for again on every poll return — several times a second in a busy
           * room. Each attempt renegotiates the subscriber session, so one
           * unpullable track became a permanent renegotiation storm on the
           * connection carrying every voice in the room.
           */
          if (Date.now() < (this.pullAfter.get(key) ?? 0)) continue;
          wants.push({
            key,
            peerId: r.peerId,
            name,
            sessionId: r.sfuSessionId as string,
            retry: this.pullTries.has(key),
          });
        }
      }

      if (wants.length === 0) {
        if (this.pendingWork()) this.scheduleRetry(RETRY_TICK_MS);
        return;
      }

      const batch = this.nextBatch(wants);

      /*
       * The first pull creates the session in the same request (rule 1), so
       * there is never a session sitting idle waiting for somebody to arrive.
       */
      const creating = !this.subscriberSession;
      if (!this.subscriber) {
        this.subscriber = this.pc();
        this.subscriber.ontrack = (e) => this.onTrack(e);
        this.watch(this.subscriber, "sub");
      } else if (!creating && this.incoming.size > 0) {
        // Not the first pull: the server holds anything that needs a transport
        // still coming up, so give it the moment it needs here instead.
        await this.connected(this.subscriber, CONNECT_WAIT_MS);
        if (!current() || !this.subscriber) return;
      }
      const sub = this.subscriber;

      let res: Record<string, unknown>;
      try {
        res = await this.api("pull", {
          session: this.subscriberSession ?? undefined,
          proof: this.subscriberProof || undefined,
          tracks: batch.map((w) => ({ sessionId: w.sessionId, trackName: w.name })),
        });
      } catch (e) {
        if (!current()) return;
        /*
         * Nothing is marked until it has arrived, so a failed call simply means
         * the next attempt tries again. What the failure says about the
         * session decides whether that attempt can use it (rule 4).
         */
        const kind = classifySfuError(e);
        const message = e instanceof Error ? e.message : String(e);
        if (!creating && (kind === "gone" || kind === "wedged" || kind === "uncertain")) {
          this.rebuildSubscriber(`a pull failed (${kind}): ${message}`);
          return;
        }
        this.retryFirstPull(creating);
        return;
      }
      // Replaced while the request was out. Whatever it allocated belongs to a
      // session nothing will use again.
      if (!current()) return;

      if (creating) {
        if (typeof res.sessionId !== "string") {
          console.error("[sfu] the media server answered a first pull without a session");
          this.retryFirstPull(true);
          return;
        }
        this.firstPullFailures = 0;
        this.subscriberSession = res.sessionId;
        this.subscriberProof = typeof res.proof === "string" ? res.proof : "";
      }

      /*
       * The SFU says which mid each track landed on. This is the whole reason
       * the SFU path cannot suffer the slot confusion the mesh path did: the
       * mapping is stated rather than inferred.
       *
       * By POSITION, not by name. Every person's camera is called "cam", so
       * matching on the name alone would give three people's video to whoever
       * happened to be first in the list. The response is in the order the
       * tracks were asked for, and `batch` was built in that same order.
       */
      const results =
        (res.tracks as {
          mid?: string;
          trackName?: string;
          errorCode?: string;
          errorDescription?: string;
          error?: { errorCode?: string; errorDescription?: string };
        }[]) ?? [];

      results.forEach((t, i) => {
        const who = batch[i];
        if (!who) return;

        const errorCode = t.errorCode ?? t.error?.errorCode;
        /*
         * A per-track failure comes back inside a 200, which is how this
         * managed to look like success. Left unmarked, so the next attempt
         * asks again — a track that is not there yet usually is a moment
         * later. Quickly at first, then every twenty seconds, for as long as
         * the roster says it exists. Never given up on: a microphone that
         * took a minute to publish is still a microphone somebody is talking
         * into.
         */
        if (errorCode || t.error || !t.mid) {
          const tries = (this.pullTries.get(who.key) ?? 0) + 1;
          this.pullTries.set(who.key, tries);
          const quick = Math.min(1000 * 2 ** (tries - 1), PULL_BACKOFF_MAX_MS);
          const wait =
            tries >= PULL_ATTEMPTS
              ? SLOW_RETRY_MS
              : errorCode === "empty_track_error"
                ? Math.max(quick, EMPTY_TRACK_RETRY_MS)
                : quick;
          this.pullAfter.set(who.key, Date.now() + wait);
          if (tries === PULL_ATTEMPTS) {
            const why = t.errorDescription ?? t.error?.errorDescription ?? "no reason given";
            console.warn(
              `[sfu] ${who.name} from ${who.peerId} has not been available ${tries} times ` +
                `(${why}); asking every ${SLOW_RETRY_MS / 1000}s from now on`,
            );
            this.report("track-unavailable", `${who.name} from ${who.peerId}: ${errorCode ?? why}`);
          }
          return;
        }

        if (t.trackName && t.trackName !== who.name) {
          // Order and names disagreeing means an assumption here is wrong, and
          // silently mis-routing somebody's camera is the expensive outcome.
          console.warn("[sfu] pull result out of order", t.trackName, who.name);
          return;
        }

        // Marked only now, having actually been allocated a mid.
        this.pullTries.delete(who.key);
        this.pullAfter.delete(who.key);
        this.pulled.add(who.key);
        this.pulledFrom.set(who.key, who.sessionId);
        this.incoming.set(t.mid, { peerId: who.peerId, name: who.name, sessionId: who.sessionId });
        // A mid can be used again for a new track once it has been closed.
        this.handedBack.delete(t.mid);
        this.orphanTries.delete(t.mid);
      });

      const offer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (!offer?.sdp) {
        this.continueSoon();
        return;
      }

      try {
        await sub.setRemoteDescription(offer);
        const answer = await sub.createAnswer();
        if (answer.sdp) answer.sdp = tuneOpus(answer.sdp, this.audioShape());
        await sub.setLocalDescription(answer);
        await this.gathered(sub);

        await this.api("renegotiate", {
          session: this.subscriberSession,
          proof: this.subscriberProof,
          sdp: {
            type: "answer",
            sdp: sub.localDescription?.sdp ?? "",
          },
        });
      } catch (e) {
        if (!current()) return;
        /*
         * The media server is waiting for an answer it may never have got.
         * Until it does, it refuses every later change to this session, so the
         * session is finished whichever way the call actually went (rule 4).
         */
        const message = e instanceof Error ? e.message : String(e);
        this.rebuildSubscriber(`the answer to a pull did not go through (${classifySfuError(e)}): ${message}`);
        return;
      }
      if (!current()) return;
      this.tuneAudio();

      if (this.orphans.size > 0) void this.closeOrphans();
      this.continueSoon();
    });
  }

  /**
   * Close tracks the media server is sending that nothing here asked for.
   *
   * A pull the server carried out whose answer never reached us leaves a
   * track on the session that no mapping names. The next description brings
   * it along, it arrives on an "unmapped mid", and it is never played; but it
   * is decoded and buffered for the rest of the meeting. So it is handed back,
   * and asked for again properly if it was somebody's.
   */
  private closeOrphans(): Promise<void> {
    return this.queue("sub", async () => {
      if (this.stopped || !this.subscriber || !this.subscriberSession) return;
      const mids = [...this.orphans].filter((m) => !this.incoming.has(m));
      this.orphans.clear();
      if (mids.length === 0) return;
      try {
        await this.api("close", {
          session: this.subscriberSession,
          proof: this.subscriberProof,
          mids,
        });
        for (const m of mids) {
          this.handedBack.add(m);
          this.orphanTries.delete(m);
        }
      } catch (e) {
        // Tried again after the next pull that succeeds, three times at most:
        // a close the server keeps refusing must not ride along on every pull.
        for (const m of mids) {
          const tries = (this.orphanTries.get(m) ?? 0) + 1;
          this.orphanTries.set(m, tries);
          if (tries < 3) this.orphans.add(m);
          else this.handedBack.add(m);
        }
        console.warn(`[sfu] could not close ${mids.length} orphaned track(s); will try again`, e);
      }
    });
  }

  /**
   * Give back everything belonging to people who have left the room.
   *
   * Every kind, not just cameras: a microphone is a decoder and a jitter
   * buffer too, and it is the one that is always there. Closing the mid is
   * what lets the media server stop sending, lets the browser release the
   * decoder, and lets the mid be used again.
   */
  private async reclaimDeparted(live: Set<string>): Promise<void> {
    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      if (!live.has(who.peerId)) mids.push(mid);
    }
    for (const mid of await this.closeMids(mids)) this.forget(mid);
  }

  /**
   * Let go of tracks whose publisher has started again.
   *
   * A publisher that is rebuilt goes onto a NEW media session, and the roster
   * then carries the new session id. The mids we hold point at tracks on the
   * old one, which will never carry another packet. Closing them and striking
   * `pulled` is what makes the next sync ask for the person again — on the
   * session they are actually on.
   */
  private async reclaimRepublished(others: RosterEntry[]): Promise<void> {
    const current = new Map(others.map((r) => [r.peerId, r.sfuSessionId as string]));
    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      const now = current.get(who.peerId);
      if (now && now !== who.sessionId) mids.push(mid);
    }
    if (mids.length === 0) return;
    console.info(`[sfu] ${mids.length} track(s) belong to a session that was replaced; pulling again`);
    for (const mid of await this.closeMids(mids)) this.forget(mid);
  }

  /**
   * Stop paying for pictures nobody is looking at.
   *
   * Audio is never dropped here. Only cameras, and only cameras belonging to
   * people who are still in the room but no longer on screen — somebody who
   * has left is handled by `reclaimDeparted`.
   */
  private async dropUnwatched(live: Set<string>): Promise<void> {
    if (this.videoInterest === null) return;

    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      if (who.name !== TRACK_NAMES.camera) continue;
      if (!live.has(who.peerId)) continue;
      if (this.videoInterest.has(who.peerId)) continue;
      mids.push(mid);
    }

    for (const mid of await this.closeMids(mids)) {
      const who = this.incoming.get(mid);
      this.forget(mid);
      if (!who) continue;
      const bundle = this.media.get(who.peerId);
      if (!bundle) continue;
      for (const t of bundle.stream.getVideoTracks()) bundle.stream.removeTrack(t);
      this.events.onMedia(who.peerId, {
        stream: new MediaStream(bundle.stream.getTracks()),
        screen: new MediaStream(bundle.screen.getTracks()),
      });
    }
  }

  /**
   * Stop accounting for one mid.
   *
   * Struck from `pulled` as well as from `incoming`, so the same track coming
   * back — a camera returning to screen, a person rejoining — is asked for
   * again rather than found already recorded as had.
   */
  private forget(mid: string): void {
    const who = this.incoming.get(mid);
    if (!who) return;
    this.incoming.delete(mid);
    const key = `${who.peerId}:${who.name}`;
    this.pulled.delete(key);
    this.pulledFrom.delete(key);
    this.pullTries.delete(key);
    this.pullAfter.delete(key);
  }

  /**
   * Tell the media server to stop sending these.
   *
   * Returns the mids it accepted, still present in `incoming` so the caller
   * can read what they were before calling `forget` on each.
   *
   * A failed close is left alone and tried again on the next poll — failing to
   * close costs bandwidth for a few seconds, forgetting something the server is
   * still sending loses a voice outright — unless the failure says the session
   * itself is finished, in which case it is replaced.
   */
  private async closeMids(mids: string[]): Promise<string[]> {
    if (mids.length === 0) return [];
    if (!this.subscriber || !this.subscriberSession) return [];

    try {
      await this.api("close", {
        session: this.subscriberSession,
        proof: this.subscriberProof,
        mids,
      });
    } catch (e) {
      if (classifySfuError(e) === "gone") {
        this.rebuildSubscriber(`closing tracks found the session finished: ${(e as Error).message}`);
        return [];
      }
      console.warn(
        `[sfu] the media server would not close ${mids.length} track(s); trying again on the next poll`,
        e,
      );
      return [];
    }
    // Closed on purpose: a later description that still lists them is not an orphan.
    for (const m of mids) this.handedBack.add(m);
    return mids.filter((mid) => this.incoming.has(mid));
  }

  private onTrack(e: RTCTrackEvent): void {
    const mid = e.transceiver.mid;
    const who = mid ? this.incoming.get(mid) : undefined;
    if (!who) {
      // Nothing to guess at: an orphan of a pull whose answer was lost (see
      // `closeOrphans`). Not played, and handed back once this pull settles.
      if (!mid || this.handedBack.has(mid)) return;
      console.warn("[sfu] a track arrived on an unmapped mid; closing it", mid);
      this.orphans.add(mid);
      return;
    }

    if (who.name === TRACK_NAMES.mic && !this.heardAfter.has(who.peerId)) {
      const seen = this.firstSeen.get(who.peerId);
      if (seen !== undefined) {
        const ms = Date.now() - seen;
        this.heardAfter.set(who.peerId, ms);
        this.queueHeard(who.peerId, ms);
      }
    }

    let bundle = this.media.get(who.peerId);
    if (!bundle) {
      bundle = { stream: new MediaStream(), screen: new MediaStream() };
      this.media.set(who.peerId, bundle);
    }

    const target = who.name === TRACK_NAMES.screen ? bundle.screen : bundle.stream;
    for (const t of target.getTracks()) {
      if (t.kind === e.track.kind && t.id !== e.track.id) target.removeTrack(t);
    }
    if (!target.getTracks().includes(e.track)) target.addTrack(e.track);

    // A fresh MediaStream per change, for the same reason the mesh path needs
    // one: a `<video>` holds srcObject by reference and never notices a stream
    // mutated underneath it.
    this.events.onMedia(who.peerId, {
      stream: new MediaStream(bundle.stream.getTracks()),
      screen: new MediaStream(bundle.screen.getTracks()),
    });

    e.track.onended = () => this.events.onMedia(who.peerId, {
      stream: new MediaStream(bundle.stream.getTracks()),
      screen: new MediaStream(bundle.screen.getTracks()),
    });

    // Before the first packet is played, not after the first gap is heard.
    if (who.name === TRACK_NAMES.mic) this.tuneAudio();
  }

  /**
   * Report how long each voice took to arrive, a few at a time.
   *
   * This is the number the complaint was about, and until now it lived only in
   * the People panel of whoever happened to open it.
   */
  private queueHeard(peerId: string, ms: number): void {
    this.heardQueue.push(`${peerId.slice(0, 8)}=${ms}ms`);
    if (this.heardTimer) return;
    this.heardTimer = setTimeout(() => {
      this.heardTimer = null;
      const line = this.heardQueue.splice(0).join(" ");
      if (line) this.report("heard", line);
    }, 3_000);
  }

  /**
   * What OUR OWN microphone is doing: is it hearing anything, and is any of it
   * leaving the machine?
   *
   * Two numbers from two different places, and the pair is the whole point.
   * `media-source` reports the energy the capture device is producing; the
   * outbound report says how many packets have actually gone. Sound going in
   * and nothing going out is a microphone that is working perfectly and is not
   * in the meeting.
   */
  async outgoingAudio(): Promise<{
    bytesSent: number;
    packetsSent: number;
    audioEnergy: number;
    audioLevel: number;
  } | null> {
    if (!this.publisher) return null;
    const out = { bytesSent: 0, packetsSent: 0, audioEnergy: 0, audioLevel: 0 };
    try {
      const report = await this.publisher.getStats();
      report.forEach((r) => {
        const x = r as unknown as Record<string, number | string>;
        if (x.type === "outbound-rtp" && x.kind === "audio") {
          out.bytesSent += Number(x.bytesSent ?? 0);
          out.packetsSent += Number(x.packetsSent ?? 0);
        }
        if (x.type === "media-source" && x.kind === "audio") {
          out.audioEnergy = Number(x.totalAudioEnergy ?? 0);
          out.audioLevel = Number(x.audioLevel ?? 0);
        }
      });
    } catch {
      // A connection that is closing has nothing to report, which is not a
      // fault and must not be read as a silent microphone.
      return null;
    }
    return out;
  }

  /**
   * Everything both connections have moved, for the bill.
   *
   * Cumulative since the connection opened, not a rate: the server keeps the
   * larger of what it has and what arrives, so a reconnection that resets
   * these counters cannot make a church's total go backwards.
   */
  async totals(): Promise<{ received: number; sent: number }> {
    let received = 0;
    let sent = 0;
    for (const pc of [this.publisher, this.subscriber]) {
      if (!pc) continue;
      try {
        const report = await pc.getStats();
        report.forEach((r) => {
          const x = r as unknown as Record<string, number | string>;
          if (x.type === "inbound-rtp") received += Number(x.bytesReceived ?? 0);
          if (x.type === "outbound-rtp") sent += Number(x.bytesSent ?? 0);
        });
      } catch {
        /* a closing connection has nothing to report */
      }
    }
    return { received, sent };
  }

  /**
   * What is arriving from each person, for the People panel.
   *
   * Per receiver rather than per connection. Everybody arrives down ONE
   * subscriber connection here, so connection-level totals would say "video is
   * arriving" while being unable to say from whom — which is precisely the
   * question. `mid` is the join: the SFU told us which mid each person's track
   * landed on when we pulled it.
   *
   * It is also where a DEAD track is noticed. A track the roster says is on,
   * that has carried nothing for three samples running, is a track the media
   * server has stopped forwarding, and it is closed and asked for again
   * rather than left silent for the rest of the call.
   */
  async diagnose(): Promise<Map<string, SfuPeerReading>> {
    const out = new Map<string, SfuPeerReading>();
    const sub = this.subscriber;
    if (!sub) return out;

    const now = Date.now();
    const ice = sub.iceConnectionState;
    const stale: string[] = [];
    const roster = new Map(this.lastRoster.map((r) => [r.peerId, r]));

    const blank = (peerId: string): SfuPeerReading => ({
      videoInKbps: 0,
      framesDecoded: 0,
      ice,
      audioInKbps: 0,
      audioLossPct: 0,
      audioConcealedPct: 0,
      audioJitterMs: 0,
      audioJitterBufferMs: 0,
      heardAfterMs: this.heardAfter.get(peerId) ?? null,
    });

    for (const tr of sub.getTransceivers()) {
      const who = tr.mid ? this.incoming.get(tr.mid) : undefined;
      if (!who) continue;
      if (who.name !== TRACK_NAMES.camera && who.name !== TRACK_NAMES.mic) continue;

      const row = out.get(who.peerId) ?? blank(who.peerId);
      const entry = roster.get(who.peerId);

      if (who.name === TRACK_NAMES.camera) {
        let bytes = 0;
        let frames = 0;
        try {
          const report = await tr.receiver.getStats();
          report.forEach((r) => {
            const x = r as unknown as Record<string, number | string>;
            if (x.type !== "inbound-rtp" || x.kind !== "video") return;
            bytes += Number(x.bytesReceived ?? 0);
            frames += Number(x.framesDecoded ?? 0);
          });
        } catch {
          continue;
        }

        const previous = this.lastVideoBytes.get(who.peerId);
        const seconds = previous ? (now - previous.at) / 1000 : 0;
        row.videoInKbps =
          seconds > 0
            ? Math.max(0, Math.round(((bytes - previous!.bytes) * 8) / seconds / 1000))
            : 0;
        row.framesDecoded = frames;
        const still = previous && bytes === previous.bytes && entry?.cameraOn ? previous.still + 1 : 0;
        this.lastVideoBytes.set(who.peerId, { at: now, bytes, still });
        if (still >= STALE_SAMPLES && tr.mid) stale.push(tr.mid);
        out.set(who.peerId, row);
        continue;
      }

      /*
       * The voice. Exactly the figures the mesh path reports, so the People
       * panel reads the same on both transports.
       */
      let bytes = 0;
      let packetsReceived = 0;
      let packetsLost = 0;
      let concealed = 0;
      let total = 0;
      let jitterMs = 0;
      let bufferMs = 0;
      try {
        const report = await tr.receiver.getStats();
        report.forEach((r) => {
          const x = r as unknown as Record<string, number | string>;
          if (x.type !== "inbound-rtp" || x.kind !== "audio") return;
          bytes += Number(x.bytesReceived ?? 0);
          packetsReceived += Number(x.packetsReceived ?? 0);
          packetsLost += Number(x.packetsLost ?? 0);
          /*
           * Silence subtracted. DTX means a listener sends nothing at all
           * while nobody speaks, and the player fills that with synthesised
           * silence, which the browser counts as concealment — so a healthy
           * quiet room would otherwise read as almost entirely broken.
           */
          concealed +=
            Number(x.concealedSamples ?? 0) - Number(x.silentConcealedSamples ?? 0);
          total += Number(x.totalSamplesReceived ?? 0);
          jitterMs = Math.max(jitterMs, Number(x.jitter ?? 0) * 1000);
          const delay = Number(x.jitterBufferDelay ?? 0);
          const emitted = Number(x.jitterBufferEmittedCount ?? 0);
          if (emitted > 0) bufferMs = Math.max(bufferMs, (delay / emitted) * 1000);
        });
      } catch {
        continue;
      }

      const was = this.lastAudio.get(who.peerId);
      const seconds = was ? (now - was.at) / 1000 : 0;
      const share = (curr: number, before: number, overCurr: number, overBefore: number) => {
        const top = Math.max(0, curr - before);
        const bottom = Math.max(0, overCurr - overBefore);
        return bottom > 0 ? Math.round((top / bottom) * 1000) / 10 : 0;
      };

      row.audioInKbps =
        seconds > 0
          ? Math.max(0, Math.round(((bytes - was!.bytes) * 8) / seconds / 1000))
          : 0;
      row.audioLossPct = was
        ? share(
            packetsLost,
            was.packetsLost,
            packetsLost + packetsReceived,
            was.packetsLost + was.packetsReceived,
          )
        : 0;
      row.audioConcealedPct = was
        ? share(concealed, was.concealedSamples, total, was.totalSamples)
        : 0;
      row.audioJitterMs = Math.round(jitterMs);
      row.audioJitterBufferMs = Math.round(bufferMs);

      // A microphone that is on sends something even in silence (DTX keeps a
      // packet every few hundred milliseconds), so nothing at all for twelve
      // seconds is a track that has died, not a person who has stopped talking.
      const still = was && bytes === was.bytes && entry?.micOn ? was.still + 1 : 0;
      this.lastAudio.set(who.peerId, {
        at: now,
        bytes,
        still,
        packetsReceived,
        packetsLost,
        concealedSamples: concealed,
        totalSamples: total,
      });
      if (still >= STALE_SAMPLES && tr.mid) stale.push(tr.mid);
      out.set(who.peerId, row);
    }

    if (stale.length > 0) void this.repull(stale);

    return out;
  }

  /** Close dead tracks and ask for them again on the next sync. */
  private repull(mids: string[]): Promise<void> {
    return this.queue("sub", async () => {
      if (this.stopped) return;
      const names = mids.map((m) => this.incoming.get(m)).filter(Boolean).map((w) => `${w!.name} from ${w!.peerId}`);
      console.warn(`[sfu] ${names.join(", ")} carried nothing for a while though the roster says on; pulling again`);
      this.report("track-stale", names.join(", "));
      for (const mid of await this.closeMids(mids)) {
        const who = this.incoming.get(mid);
        this.forget(mid);
        if (who) {
          this.lastAudio.delete(who.peerId);
          this.lastVideoBytes.delete(who.peerId);
        }
      }
      this.scheduleRetry(0);
    });
  }

  /** Close the publishing connection and forget everything negotiated on it. */
  private discardPublisher(): void {
    this.pubGeneration += 1;
    if (this.disconnectTimers.pub) clearTimeout(this.disconnectTimers.pub);
    this.disconnectTimers.pub = null;
    try {
      this.publisher?.close();
    } catch {
      /* already closed */
    }
    this.publisher = null;
    this.publisherSession = null;
    this.publisherProof = "";
    this.senders.clear();
    this.published = {};
    this.idleSince.clear();
  }

  /**
   * Throw the publishing connection away and publish again on a backoff.
   *
   * Neither connection was ever rebuilt once. A publisher that failed left this
   * person permanently mute with the pill saying "retrying", with nothing in
   * the code that could ever repair it.
   */
  private failPublisher(why: string): void {
    if (this.stopped) return;
    console.warn(`[sfu] ${why}; publishing again`);
    this.report("publisher-rebuilt", why);
    this.discardPublisher();
    this.events.onError(
      "Your connection to the meeting dropped. Putting it back together.",
    );
    this.scheduleRepublish();
  }

  /**
   * Publish what was last asked for again, on a backoff: 1s, 2s, 4s, 8s, then
   * every 15s for as long as the meeting lasts. One pending attempt at a time;
   * a `setLocal` from a button press in the meantime simply gets there first.
   */
  private scheduleRepublish(): void {
    if (this.stopped || this.republishTimer || !this.lastLocal) return;
    const delay = Math.min(15_000, 1000 * 2 ** this.republishAttempts);
    this.republishAttempts += 1;
    this.republishTimer = setTimeout(() => {
      this.republishTimer = null;
      if (this.stopped || !this.lastLocal) return;
      void this.setLocal(this.lastLocal);
    }, delay);
  }

  /**
   * Throw the subscribing connection away, forget everything pulled on it, and
   * pull the room again on a new session.
   *
   * The mids it was holding belonged to a session that no longer exists, so
   * there is nothing to salvage. Rate-limited, because a media server that is
   * failing every request would otherwise be asked for a new session every
   * second and a half for as long as the meeting lasts.
   */
  private rebuildSubscriber(why: string): void {
    if (this.stopped) return;
    const now = Date.now();
    this.subRebuilds = this.subRebuilds.filter((t) => now - t < 60_000);
    this.subRebuilds.push(now);
    const recent = this.subRebuilds.length;
    const delay = recent <= 2 ? RETRY_SOON_MS : Math.min(15_000, 2_000 * 2 ** (recent - 3));

    console.warn(`[sfu] ${why}; rebuilding the subscriber (${recent} in the last minute)`);
    this.report("subscriber-rebuilt", why);

    this.subGeneration += 1;
    if (this.disconnectTimers.sub) clearTimeout(this.disconnectTimers.sub);
    this.disconnectTimers.sub = null;
    try {
      this.subscriber?.close();
    } catch {
      /* already closed */
    }
    this.subscriber = null;
    this.subscriberSession = null;
    this.subscriberProof = "";
    this.orphans.clear();
    this.handedBack.clear();
    this.orphanTries.clear();
    for (const [peerId] of this.media) this.events.onGone(peerId);
    this.media.clear();
    this.incoming.clear();
    this.pulled.clear();
    this.pulledFrom.clear();
    this.pullTries.clear();
    this.pullAfter.clear();
    this.lastAudio.clear();
    this.lastVideoBytes.clear();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.scheduleRetry(delay);
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.republishTimer) clearTimeout(this.republishTimer);
    this.republishTimer = null;
    if (this.heardTimer) clearTimeout(this.heardTimer);
    this.heardTimer = null;
    for (const which of ["pub", "sub"] as const) {
      const timer = this.disconnectTimers[which];
      if (timer) clearTimeout(timer);
      this.disconnectTimers[which] = null;
    }
    for (const pc of [this.publisher, this.subscriber]) {
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
    }
    this.stopPlaceholders();
    this.publisher = null;
    this.subscriber = null;
    this.media.clear();
    this.incoming.clear();
    this.pulled.clear();
    this.pulledFrom.clear();
    this.pullTries.clear();
    this.pullAfter.clear();
    this.senders.clear();
    this.idleSince.clear();
    this.lastAudio.clear();
    this.lastVideoBytes.clear();
    this.firstSeen.clear();
    this.heardAfter.clear();
  }
}
