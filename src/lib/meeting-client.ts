/**
 * The meeting engine — browser only.
 *
 * One class owns everything that is hard about a call: the peer connections,
 * the negotiation, the local camera and microphone, the bandwidth budget, the
 * reconnection, and the long-poll that carries signalling. The React layer
 * above it only renders what this reports.
 *
 * It is a MESH. Every participant connects directly to every other one, so
 * nothing but signalling touches our server — no media server to run, no
 * per-minute cost, and the audio path is as short as it can physically be,
 * which is what makes it usable on a slow link. The price is that your upload
 * multiplies by the number of other people, and `profileFor` in
 * meetings-shared.ts is what keeps that inside a phone's budget.
 */

import {
  isPolite,
  profileFor,
  rateLink,
  shouldInitiate,
  tuneOpus,
  type BandwidthProfile,
  type MeetingQuality,
  type RosterEntry,
  type SignalEnvelope,
  type SignalType,
  type Stage,
} from "@/lib/meetings-shared";

export type TrackSlot = "audio" | "camera" | "screen";

export type RemoteMedia = {
  peerId: string;
  stream: MediaStream;
  hasAudio: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
  /** The screen share, kept apart so it can go on the stage full size. */
  screenStream: MediaStream | null;
};

export type LocalState = {
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  lowData: boolean;
  quality: MeetingQuality;
  profile: BandwidthProfile;
  /** Which camera is in use, so the flip button knows where it is. */
  facing: "user" | "environment";
};

/** What one peer connection is actually doing, for the diagnostics panel. */
export type PeerDiagnostics = {
  peerId: string;
  /** "connected", "checking", "failed" — the ICE layer's own verdict. */
  ice: RTCIceConnectionState;
  /** Whether a camera track is attached to this peer's sender at all. */
  videoAttached: boolean;
  /** Why it is not, when it is not. The most useful line in the whole panel. */
  videoWithheld: "camera-off" | "they-save-data" | null;
  /** Kilobits per second leaving for this peer, measured across two samples. */
  videoOutKbps: number;
  audioOutKbps: number;
  /** And arriving from them. */
  videoInKbps: number;
  audioInKbps: number;
  /** What the relay decided: "host" is direct, "relay" went through TURN. */
  transport: string | null;
  /**
   * Frames actually decoded from this peer, in total.
   *
   * Separate from bytes on purpose. Bytes arriving says the network works;
   * frames decoded says the picture exists. Zero frames with healthy bytes is
   * a codec or decoder problem, and frames with a black tile is a rendering
   * problem — two completely different investigations that look identical
   * without this number.
   */
  framesDecoded: number;
  framesDropped: number;
  /**
   * What the `<video>` element showing this peer is doing, reported back by
   * the tile. The last link in the chain, and the only one `getStats` cannot
   * see: frames can decode perfectly into an element that is paused, has no
   * stream, or has never been given dimensions.
   */
  element?: { width: number; paused: boolean; readyState: number } | null;
};

export type MeetingClientEvents = {
  onRoster?: (roster: RosterEntry[]) => void;
  onStage?: (stage: Stage) => void;
  onMedia?: (media: Map<string, RemoteMedia>) => void;
  onLocalState?: (state: LocalState) => void;
  onChat?: (msg: {
    id: string;
    authorName: string;
    body: string;
    kind: string;
    createdAt: string;
  }) => void;
  onReaction?: (peerId: string, emoji: string) => void;
  /**
   * Who the host has put on the main screen, or null for nobody.
   *
   * Arrives two ways and needs to: as a broadcast when the host changes it,
   * so the room reacts at once, and on every poll, so somebody joining late
   * or reconnecting lands on the same screen as everybody else.
   */
  onSpotlight?: (peerId: string | null) => void;
  onControl?: (payload: Record<string, unknown>) => void;
  onRecording?: (payload: Record<string, unknown>) => void;
  onEnded?: (reason: string) => void;
  onError?: (message: string) => void;
  /**
   * A camera or microphone did not open. Separate from `onError` because the
   * UI has the translator and this needs saying in the reader's language.
   */
  onMediaFault?: (fault: MediaFault, device: "microphone" | "camera") => void;
  /** Transport health, so the UI can say "reconnecting" honestly. */
  onTransport?: (state: "online" | "retrying" | "offline") => void;
};

export type MeetingClientInit = {
  code: string;
  peerId: string;
  secret: string;
  cursor: number;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  lowData: boolean;
  events: MeetingClientEvents;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  initiator: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  negotiated: boolean;
  /** Our three fixed media slots, in m-line order. */
  slots: Partial<Record<TrackSlot, RTCRtpTransceiver>>;
  stream: MediaStream;
  screenStream: MediaStream;
  /** False while this peer is in low-data mode and wants no video from us. */
  wantsVideo: boolean;
  restarts: number;
  lastStats: { at: number; packetsSent: number; packetsLost: number };
  /** Its own id, so a diagnostics row can be read off the peer alone. */
  peerId: string;
  /** Byte totals from the previous sample, for turning totals into rates. */
  lastBytes: {
    at: number;
    videoOut: number;
    audioOut: number;
    videoIn: number;
    audioIn: number;
  } | null;
  /** The last reading, kept so the panel never has to await `getStats`. */
  diagnostics: PeerDiagnostics | null;
  /**
   * The copies actually handed to React, and the track ids they were made
   * from. See `publishable` — this is what stops a `<video>` element holding a
   * reference to a stream whose tracks have since been swapped underneath it.
   */
  published: { key: string; stream: MediaStream } | null;
  publishedScreen: { key: string; stream: MediaStream } | null;
};

const SEND_DEBOUNCE_MS = 40;
const STATS_INTERVAL_MS = 4000;
/** How long to wait before another long-poll after a failed one. Backs off. */
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 8000;

/** Which of the four things went wrong when a camera or microphone did not open. */
export type MediaFault = "blocked" | "missing" | "inUse" | "unknown" | "unsupported";

/**
 * Name the cause, do not write the sentence.
 *
 * Exported because the join screen asks for the same devices before the client
 * exists, and two different explanations of one failure is worse than either.
 * It returns a cause rather than a message because this module has no `t` and
 * the meetings UI is translated into eight languages — a hardcoded English
 * string here would land on exactly the person least able to act on it.
 *
 * The distinctions matter. `NotAllowedError` means they said no, or the page
 * is not on HTTPS. `NotFoundError` means there is no such device.
 * `NotReadableError` means another app holds it — on a phone, almost always a
 * call or another tab. Each needs a different thing from the person, and one
 * sentence covering all of them helps with none.
 */
export function mediaFault(error: unknown): MediaFault {
  const name = (error as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "AbortError":
      return "inUse";
    default:
      return "unknown";
  }
}

export class MeetingClient {
  private readonly code: string;
  private readonly peerId: string;
  private readonly secret: string;
  private readonly events: MeetingClientEvents;
  private readonly rtcConfig: RTCConfiguration;

  private cursor: number;
  private running = false;
  private listening: AbortController | null = null;

  private peers = new Map<string, PeerState>();
  private media = new Map<string, RemoteMedia>();
  private rosterCache: RosterEntry[] = [];

  private micStream: MediaStream | null = null;
  private camStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  private state: LocalState;
  private outbox: { to?: string | null; type: SignalType; payload: Record<string, unknown> }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private retryDelay = RETRY_BASE_MS;

  constructor(init: MeetingClientInit) {
    this.code = init.code;
    this.peerId = init.peerId;
    this.secret = init.secret;
    this.cursor = init.cursor;
    this.events = init.events;
    this.rtcConfig = {
      iceServers: init.iceServers,
      iceTransportPolicy: init.iceTransportPolicy ?? "all",
      // A handful of candidates is plenty on a mesh and gathering fewer gets
      // the first one out sooner, which is what the person waiting notices.
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
    this.state = {
      micOn: false,
      cameraOn: false,
      sharing: false,
      lowData: init.lowData,
      quality: "good",
      profile: profileFor({ peers: 1, lowData: init.lowData }),
      facing: "user",
    };
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.listenLoop();
    this.statsTimer = setInterval(() => void this.sampleStats(), STATS_INTERVAL_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /**
   * Shut everything down, in an order that does not leave a camera light on.
   * Safe to call more than once — React will, in development.
   */
  async stop(): Promise<void> {
    if (!this.running && this.peers.size === 0) return;
    this.running = false;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listening?.abort();

    for (const [, p] of this.peers) {
      try {
        p.pc.close();
      } catch {
        /* already gone */
      }
    }
    this.peers.clear();
    this.media.clear();

    this.stopStream(this.micStream);
    this.stopStream(this.camStream);
    this.stopStream(this.screenStream);
    this.micStream = this.camStream = this.screenStream = null;
  }

  private stopStream(s: MediaStream | null) {
    s?.getTracks().forEach((t) => t.stop());
  }

  /**
   * A backgrounded tab on a phone gets its timers throttled to once a minute,
   * which is long enough for the room to decide we have left. Coming back into
   * view kicks the listener immediately rather than waiting for the next tick.
   */
  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.running) {
      this.listening?.abort();
    }
  };

  /* ============================================================
   * Transport
   *
   * One request in flight at a time for listening, held open by the server
   * until something arrives. Anything we need to SEND goes out on its own
   * request so it never waits behind the hold.
   * ========================================================== */

  private async listenLoop(): Promise<void> {
    while (this.running) {
      const controller = new AbortController();
      this.listening = controller;
      try {
        const res = await fetch(`/api/meet/${this.code}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            peer: this.peerId,
            secret: this.secret,
            cursor: this.cursor,
            wait: true,
          }),
        });

        if (res.status === 401) {
          this.events.onEnded?.("You were signed out of this meeting.");
          this.running = false;
          return;
        }
        if (!res.ok) throw new Error(`sync ${res.status}`);

        const data = await res.json();
        this.retryDelay = RETRY_BASE_MS;
        this.events.onTransport?.("online");
        await this.consume(data);
      } catch (e) {
        if (!this.running) return;
        // An abort is us, on purpose (a visibility kick, or shutting down).
        const aborted = e instanceof DOMException && e.name === "AbortError";
        if (!aborted) {
          this.events.onTransport?.(
            this.retryDelay >= RETRY_MAX_MS ? "offline" : "retrying",
          );
          await this.sleep(this.retryDelay);
          this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2);
        }
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Queue a signal. Sends coalesce, which matters most for ICE candidates. */
  private send(
    type: SignalType,
    payload: Record<string, unknown>,
    to?: string | null,
  ): void {
    this.outbox.push({ to: to ?? null, type, payload });
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), SEND_DEBOUNCE_MS);
  }

  private async flush(state?: Record<string, unknown>): Promise<void> {
    this.flushTimer = null;
    const signals = this.outbox;
    this.outbox = [];
    if (signals.length === 0 && !state) return;

    try {
      const res = await fetch(`/api/meet/${this.code}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peer: this.peerId,
          secret: this.secret,
          cursor: this.cursor,
          wait: false,
          signals: signals.map((s) => ({ to: s.to, type: s.type, payload: s.payload })),
          state,
        }),
      });
      if (res.ok) await this.consume(await res.json());
    } catch {
      // Put them back at the front — an ICE candidate that never arrives is a
      // call that never connects, and the listen loop will retry shortly.
      this.outbox = [...signals, ...this.outbox].slice(-120);
    }
  }

  /** Tell the room our controls changed, and persist it. */
  private pushState(): void {
    this.events.onLocalState?.({ ...this.state });
    void this.flush({
      micOn: this.state.micOn,
      cameraOn: this.state.cameraOn,
      sharing: this.state.sharing,
      lowData: this.state.lowData,
      quality: this.state.quality,
    });
  }

  private async consume(data: {
    cursor?: number;
    signals?: SignalEnvelope[];
    roster?: RosterEntry[];
    stage?: Stage;
    ended?: boolean;
    removed?: boolean;
    waitingForHost?: boolean;
  }): Promise<void> {
    if (typeof data.cursor === "number" && data.cursor > this.cursor) {
      this.cursor = data.cursor;
    }
    if (data.removed) {
      this.events.onEnded?.("You were removed from this meeting.");
      this.running = false;
      return;
    }
    if (data.ended) {
      this.events.onEnded?.("This meeting has ended.");
      this.running = false;
      return;
    }
    if (data.stage) this.events.onStage?.(data.stage);
    // Always, including when it is null: clearing has to travel too.
    if ("spotlightPeerId" in data) {
      this.events.onSpotlight?.(
        typeof data.spotlightPeerId === "string" ? data.spotlightPeerId : null,
      );
    }
    if (data.roster) {
      this.rosterCache = data.roster;
      this.events.onRoster?.(data.roster);
      this.reconcilePeers(data.roster);
    }
    for (const s of data.signals ?? []) await this.handleSignal(s);
  }

  /* ============================================================
   * Who is in the room
   * ========================================================== */

  /**
   * Bring the set of peer connections in line with the roster: call anyone new,
   * hang up on anyone gone. Driven entirely by the roster rather than by join
   * and leave events, so a missed event self-heals on the next poll instead of
   * leaving a permanent black tile.
   */
  private reconcilePeers(roster: RosterEntry[]): void {
    const present = new Set(
      roster.filter((r) => r.admitted && r.peerId !== this.peerId).map((r) => r.peerId),
    );

    for (const peerId of present) {
      if (!this.peers.has(peerId)) this.createPeer(peerId);
    }

    /*
     * Who wants pictures, taken from the roster rather than inferred.
     *
     * `wantsVideo` decides whether this peer gets my camera track at all, and
     * it used to be seeded from MY OWN Data Saver setting and then corrected
     * only by a `pause` signal — which is sent when somebody TOGGLES Data
     * Saver, and never when they simply join with it on.
     *
     * That produced the worst failure this module has had. Join with Data
     * Saver on, turn it off, turn the camera on: every peer connection made
     * during that window is still flagged as not wanting video, so the camera
     * track is never attached to any of them. The local preview works, because
     * that is the local stream. Nobody else ever receives a single frame, and
     * nothing anywhere says why.
     *
     * The server already knows each participant's own `lowData` and sends it
     * in the roster on every poll. That is authoritative, it is about the
     * right person, and it repairs itself within a poll if anything is ever
     * missed. The `pause` signal stays as the instant path; this is the truth.
     */
    for (const r of roster) {
      const p = this.peers.get(r.peerId);
      if (!p) continue;
      const wants = !r.lowData;
      if (p.wantsVideo === wants) continue;
      p.wantsVideo = wants;
      this.attachLocalTracks(p);
    }
    for (const [peerId, p] of this.peers) {
      if (!present.has(peerId)) {
        try {
          p.pc.close();
        } catch {
          /* already closed */
        }
        this.peers.delete(peerId);
        this.media.delete(peerId);
      }
    }

    this.events.onMedia?.(new Map(this.media));
    this.applyProfile();
  }

  private createPeer(peerId: string): PeerState {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const initiator = shouldInitiate(this.peerId, peerId);

    const p: PeerState = {
      pc,
      polite: isPolite(this.peerId, peerId),
      initiator,
      makingOffer: false,
      ignoreOffer: false,
      negotiated: false,
      slots: {},
      stream: new MediaStream(),
      screenStream: new MediaStream(),
      // Optimistic, and corrected from the roster on the next poll. This
      // used to read `!this.state.lowData` — MY setting, used to decide what
      // somebody else receives, which is how video came to be silently
      // withheld from everybody. See `reconcilePeers`.
      wantsVideo: true,
      restarts: 0,
      lastStats: { at: 0, packetsSent: 0, packetsLost: 0 },
      peerId,
      lastBytes: null,
      diagnostics: null,
      published: null,
      publishedScreen: null,
    };
    this.peers.set(peerId, p);

    /*
     * Three transceivers, always, in this order: microphone, camera, screen.
     *
     * Creating them up front and never adding more is what makes the rest of
     * this file simple. Turning a camera on becomes `replaceTrack`, which
     * needs no renegotiation at all — so a room full of people switching
     * cameras on and off never re-offers, and there is no m-line ordering to
     * reason about. Identifying an incoming track is then just "which of my
     * three slots is this", instead of guessing from a stream id.
     */
    p.slots.audio = pc.addTransceiver("audio", { direction: "sendrecv" });
    p.slots.camera = pc.addTransceiver("video", { direction: "sendrecv" });
    p.slots.screen = pc.addTransceiver("video", { direction: "sendrecv" });

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send("ice", { candidate: e.candidate.toJSON() }, peerId);
    };

    pc.ontrack = (e) => this.onRemoteTrack(peerId, p, e);

    pc.onnegotiationneeded = async () => {
      // The first offer belongs to the initiator alone — both sides learn
      // about each other at the same instant, and two simultaneous first
      // offers are a collision for no reason. Later renegotiations may come
      // from either side; perfect negotiation sorts those out.
      if (!p.negotiated && !p.initiator) return;
      await this.makeOffer(peerId, p);
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") this.restartIce(peerId, p);
      if (s === "disconnected") {
        // Give it a few seconds: "disconnected" is frequently a phone changing
        // masts and recovers by itself. Restarting immediately would throw
        // away a connection that was about to come back.
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") this.restartIce(peerId, p);
        }, 4000);
      }
    };

    this.attachLocalTracks(p);
    return p;
  }

  private async makeOffer(peerId: string, p: PeerState): Promise<void> {
    try {
      p.makingOffer = true;
      const offer = await p.pc.createOffer();
      if (offer.sdp) offer.sdp = tuneOpus(offer.sdp, this.state.profile.audioBitrate);
      await p.pc.setLocalDescription(offer);
      this.send("offer", { sdp: p.pc.localDescription?.toJSON() }, peerId);
    } catch (e) {
      console.error("[meeting] offer failed", e);
    } finally {
      p.makingOffer = false;
    }
  }

  /**
   * An ICE restart re-gathers candidates on the existing connection, which is
   * what recovers a call after a network change — far faster and far less
   * disruptive than tearing the peer down and starting again. Capped, because
   * a peer that has genuinely gone should not be retried forever.
   */
  private async restartIce(peerId: string, p: PeerState): Promise<void> {
    if (!this.running || p.restarts >= 5) return;
    p.restarts++;
    try {
      p.pc.restartIce();
      if (p.initiator || p.polite === false) await this.makeOffer(peerId, p);
    } catch (e) {
      console.error("[meeting] ICE restart failed", e);
    }
  }

  /* ============================================================
   * Signals in
   * ========================================================== */

  private async handleSignal(s: SignalEnvelope): Promise<void> {
    switch (s.type) {
      case "offer":
      case "answer":
        await this.onDescription(s);
        return;
      case "ice":
        await this.onCandidate(s);
        return;
      case "bye": {
        const p = this.peers.get(s.fromPeer);
        if (p) {
          try {
            p.pc.close();
          } catch {
            /* already closed */
          }
          this.peers.delete(s.fromPeer);
        }
        this.media.delete(s.fromPeer);
        this.events.onMedia?.(new Map(this.media));
        return;
      }
      case "pause": {
        // A peer in low-data mode asking us to stop sending them pictures.
        const p = this.peers.get(s.fromPeer);
        if (!p) return;
        p.wantsVideo = s.payload.video !== false;
        this.attachLocalTracks(p);
        return;
      }
      case "chat":
        this.events.onChat?.({
          id: String(s.payload.id ?? crypto.randomUUID()),
          authorName: String(s.payload.authorName ?? "Someone"),
          body: String(s.payload.body ?? ""),
          kind: String(s.payload.kind ?? "chat"),
          createdAt: String(s.payload.createdAt ?? new Date().toISOString()),
        });
        return;
      case "reaction":
        this.events.onReaction?.(s.fromPeer, String(s.payload.emoji ?? "👍"));
        return;
      case "stage":
        this.events.onStage?.(s.payload as unknown as Stage);
        return;
      case "recording":
        this.events.onRecording?.(s.payload);
        return;
      case "control":
        this.onControlSignal(s);
        return;
      default:
        // "roster" and "state" arrive as signals too, but the authoritative
        // roster comes back on every poll, so there is nothing to do here.
        return;
    }
  }

  private onControlSignal(s: SignalEnvelope): void {
    const action = String(s.payload.action ?? "");

    if (action === "spotlight") {
      this.events.onSpotlight?.(
        typeof s.payload.peerId === "string" ? s.payload.peerId : null,
      );
      return;
    }

    if (action === "mute") {
      const peers = Array.isArray(s.payload.peers) ? (s.payload.peers as string[]) : [];
      if (peers.includes(this.peerId) && this.state.micOn) {
        void this.setMic(false);
      }
    }
    if (action === "removed" && s.payload.peerId === this.peerId) {
      this.events.onEnded?.("The host removed you from the meeting.");
      this.running = false;
    }
    if (action === "ended") {
      this.events.onEnded?.("The host ended the meeting.");
      this.running = false;
    }
    this.events.onControl?.(s.payload);
  }

  private async onDescription(s: SignalEnvelope): Promise<void> {
    const p = this.peers.get(s.fromPeer) ?? this.createPeer(s.fromPeer);
    const raw = s.payload.sdp as RTCSessionDescriptionInit | undefined;
    if (!raw?.type) return;

    try {
      const offerCollision =
        raw.type === "offer" && (p.makingOffer || p.pc.signalingState !== "stable");

      // Perfect negotiation, as specified: the impolite peer ignores a
      // colliding offer and keeps its own; the polite peer rolls back and
      // accepts. Exactly one of the pair is polite, so they never both give
      // way and never both insist.
      p.ignoreOffer = !p.polite && offerCollision;
      if (p.ignoreOffer) return;

      await p.pc.setRemoteDescription(raw);
      p.negotiated = true;

      if (raw.type === "offer") {
        const answer = await p.pc.createAnswer();
        if (answer.sdp) answer.sdp = tuneOpus(answer.sdp, this.state.profile.audioBitrate);
        await p.pc.setLocalDescription(answer);
        this.send("answer", { sdp: p.pc.localDescription?.toJSON() }, s.fromPeer);
      }

      this.applyProfileTo(p);
      if (this.state.lowData) this.send("pause", { video: false }, s.fromPeer);
    } catch (e) {
      console.error("[meeting] negotiation failed", e);
    }
  }

  private async onCandidate(s: SignalEnvelope): Promise<void> {
    const p = this.peers.get(s.fromPeer);
    if (!p) return;
    const candidate = s.payload.candidate as RTCIceCandidateInit | undefined;
    if (!candidate) return;
    try {
      await p.pc.addIceCandidate(candidate);
    } catch (e) {
      // Expected while an offer we chose to ignore is still in flight.
      if (!p.ignoreOffer) console.warn("[meeting] candidate rejected", e);
    }
  }

  private onRemoteTrack(peerId: string, p: PeerState, e: RTCTrackEvent): void {
    const slot: TrackSlot | null =
      e.transceiver === p.slots.audio
        ? "audio"
        : e.transceiver === p.slots.camera
          ? "camera"
          : e.transceiver === p.slots.screen
            ? "screen"
            : null;

    // A browser that associated the m-lines to its own transceivers gives us
    // objects we did not create. They arrive in the offer's order, so fall
    // back to position.
    const resolved =
      slot ??
      (["audio", "camera", "screen"][
        p.pc.getTransceivers().indexOf(e.transceiver)
      ] as TrackSlot | undefined) ??
      (e.track.kind === "audio" ? "audio" : "camera");

    const target = resolved === "screen" ? p.screenStream : p.stream;
    // Replace rather than accumulate: a peer switching camera sends a new
    // track into the same slot, and leaving the dead one attached is how a
    // tile ends up frozen on the last frame of the old one.
    for (const t of target.getTracks()) {
      if (t.kind === e.track.kind && t.id !== e.track.id) target.removeTrack(t);
    }
    if (!target.getTracks().includes(e.track)) target.addTrack(e.track);

    e.track.onended = () => {
      target.removeTrack(e.track);
      this.publishMedia(peerId, p);
    };
    e.track.onmute = () => this.publishMedia(peerId, p);
    e.track.onunmute = () => this.publishMedia(peerId, p);

    this.publishMedia(peerId, p);
  }

  /**
   * Hand out a stream whose identity changes when, and only when, its tracks do.
   *
   * This is the fix for the black remote tile, and it is worth spelling out.
   * `p.stream` is one long-lived MediaStream that gets mutated in place — a
   * track removed here, a new one added there, every time a peer restarts ICE
   * or turns a camera off and on. A `<video>` element holds `srcObject` by
   * reference, so the usual guard
   *
   *     if (el.srcObject !== stream) el.srcObject = stream;
   *
   * is false for ever after the first assignment, the element is never
   * re-pointed, and Chrome goes on rendering the track that was removed. The
   * result is a tile that is black while `getStats` cheerfully reports 300
   * kilobits a second arriving, which is exactly how this presented.
   *
   * Copying on every publish would be the other extreme: a new object several
   * times a second, so React re-renders every tile and each one re-assigns
   * `srcObject`, which makes the picture blink. So the copy is keyed on the
   * track ids — new object when the tracks change, the same object when they
   * have not.
   */
  private publishable(
    current: MediaStream,
    cache: { key: string; stream: MediaStream } | null,
  ): { key: string; stream: MediaStream } {
    const tracks = current.getTracks();
    const key = tracks
      .map((t) => t.id)
      .sort()
      .join("|");
    if (cache && cache.key === key) return cache;
    return { key, stream: new MediaStream(tracks) };
  }

  private publishMedia(peerId: string, p: PeerState): void {
    const audio = p.stream.getAudioTracks().some((t) => !t.muted);
    const camera = p.stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
    const screen = p.screenStream
      .getVideoTracks()
      .some((t) => t.readyState === "live" && !t.muted);

    p.published = this.publishable(p.stream, p.published);
    p.publishedScreen = this.publishable(p.screenStream, p.publishedScreen);

    this.media.set(peerId, {
      peerId,
      stream: p.published.stream,
      hasAudio: audio,
      hasCamera: camera,
      hasScreen: screen,
      screenStream: screen ? p.publishedScreen.stream : null,
    });
    this.events.onMedia?.(new Map(this.media));
  }

  /* ============================================================
   * Local media
   * ========================================================== */

  /** Put whatever we are currently sending into every peer's fixed slots. */
  private attachLocalTracks(p: PeerState): void {
    const mic = this.micStream?.getAudioTracks()[0] ?? null;
    const cam = this.camStream?.getVideoTracks()[0] ?? null;
    const screen = this.screenStream?.getVideoTracks()[0] ?? null;

    void p.slots.audio?.sender.replaceTrack(this.state.micOn ? mic : null);
    // Honour a peer who has asked us for no video: in low-data mode they are
    // paying for every frame we send them, whether they show it or not.
    void p.slots.camera?.sender.replaceTrack(
      this.state.cameraOn && p.wantsVideo ? cam : null,
    );
    void p.slots.screen?.sender.replaceTrack(
      this.state.sharing && p.wantsVideo ? screen : null,
    );
    this.applyProfileTo(p);
  }

  private attachEverywhere(): void {
    for (const [, p] of this.peers) this.attachLocalTracks(p);
  }

  /**
   * Ask for a device, and say something true when it does not arrive.
   *
   * Two things this does that a bare `getUserMedia` call did not.
   *
   * It retries once with the plainest possible constraints. A browser that
   * refuses `frameRate` or a `facingMode` it has no camera for fails the WHOLE
   * request with OverconstrainedError, and on iOS it does so without ever
   * prompting — so a first-time visitor saw "we couldn't reach your
   * microphone" having never been asked for permission, and no amount of
   * checking their settings would have helped.
   *
   * And it reads the error. `NotAllowedError` means they said no, or the site
   * is not on HTTPS; `NotFoundError` means there is no such device;
   * `NotReadableError` means another app holds it — on a phone, almost always
   * a call or another tab. Each needs a different thing from the person, and
   * one sentence covering all of them helps with none.
   */
  private async capture(
    wanted: MediaStreamConstraints,
    fallback: MediaStreamConstraints,
    device: "microphone" | "camera",
  ): Promise<MediaStream | null> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.events.onMediaFault?.("unsupported", device);
      return null;
    }

    try {
      return await navigator.mediaDevices.getUserMedia(wanted);
    } catch (first) {
      const name = (first as { name?: string })?.name ?? "";

      // Only a constraint problem is worth a second attempt. A refusal is a
      // refusal, and asking again just produces the same dialog.
      if (name === "OverconstrainedError" || name === "TypeError") {
        try {
          return await navigator.mediaDevices.getUserMedia(fallback);
        } catch (second) {
          this.events.onMediaFault?.(mediaFault(second), device);
          return null;
        }
      }

      this.events.onMediaFault?.(mediaFault(first), device);
      return null;
    }
  }

  async setMic(on: boolean): Promise<void> {
    if (on && !this.micStream) {
      this.micStream = await this.capture(
        {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        },
        { audio: true },
        "microphone",
      );
      if (!this.micStream) return;
    }
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.state.micOn = on;
    this.attachEverywhere();
    this.pushState();
  }

  async setCamera(on: boolean, facing?: "user" | "environment"): Promise<void> {
    const wanted = facing ?? this.state.facing;

    if (on && this.state.lowData) {
      this.events.onError?.("Turn off low-data mode to use your camera.");
      return;
    }

    if (on && (!this.camStream || facing)) {
      this.stopStream(this.camStream);
      this.camStream = null;
      const p = this.state.profile;
      this.camStream = await this.capture(
        {
          video: {
            facingMode: wanted,
            width: { ideal: p.maxWidth, max: 1280 },
            height: { ideal: p.maxHeight, max: 720 },
            frameRate: { ideal: p.frameRate, max: 30 },
          },
        },
        { video: { facingMode: wanted } },
        "camera",
      );
      if (!this.camStream) return;
      this.state.facing = wanted;
    }

    if (!on) {
      // Actually release it. Leaving the track live keeps the indicator light
      // on, which people rightly read as still being watched.
      this.stopStream(this.camStream);
      this.camStream = null;
    }

    this.state.cameraOn = on;
    this.attachEverywhere();
    this.pushState();
  }

  /** Flip between the front and back camera. Only meaningful on a phone. */
  async flipCamera(): Promise<void> {
    if (!this.state.cameraOn) return;
    await this.setCamera(true, this.state.facing === "user" ? "environment" : "user");
  }

  async setScreenShare(on: boolean): Promise<boolean> {
    if (!on) {
      this.stopStream(this.screenStream);
      this.screenStream = null;
      this.state.sharing = false;
      this.attachEverywhere();
      this.pushState();
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8, max: 15 } },
        // Whatever is on the screen usually has its own sound — a hymn video,
        // a recorded message. Asking for it costs nothing when there is none.
        audio: false,
      });
      this.screenStream = stream;
      this.state.sharing = true;

      // The browser's own "Stop sharing" bar is outside our UI, so the only
      // way to notice is the track ending.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        void this.setScreenShare(false);
      });

      this.attachEverywhere();
      this.pushState();
      return true;
    } catch {
      // Cancelling the picker is not an error worth shouting about.
      return false;
    }
  }

  /**
   * Low-data mode: no camera out, and a request to every peer to stop sending
   * pictures in. Audio continues, because the meeting is the voices.
   *
   * This is the setting that makes the module usable where it is needed most,
   * and it is one tap rather than something buried in a menu.
   */
  async setLowData(on: boolean): Promise<void> {
    this.state.lowData = on;
    if (on && this.state.cameraOn) await this.setCamera(false);
    for (const [peerId] of this.peers) this.send("pause", { video: !on }, peerId);
    this.applyProfile();
    this.pushState();
  }

  /** The tracks a recorder or a local preview needs. */
  localStreams(): { mic: MediaStream | null; camera: MediaStream | null; screen: MediaStream | null } {
    return { mic: this.micStream, camera: this.camStream, screen: this.screenStream };
  }

  remoteMedia(): Map<string, RemoteMedia> {
    return new Map(this.media);
  }

  currentState(): LocalState {
    return { ...this.state };
  }

  react(emoji: string): void {
    this.send("reaction", { emoji });
    void this.flush();
  }

  /**
   * Raise or lower a hand. Carried as peer state rather than as a message, so
   * it survives a reconnection and shows in everyone's roster on the next
   * poll — a hand that vanishes when the network hiccups is a person skipped.
   */
  setHandRaised(on: boolean): void {
    void this.flush({ handRaised: on });
  }

  /* ============================================================
   * Bandwidth
   * ========================================================== */

  private applyProfile(): void {
    const peers = Math.max(1, this.peers.size);
    this.state.profile = profileFor({
      peers,
      lowData: this.state.lowData,
      link: this.state.quality,
      screen: this.state.sharing,
    });
    for (const [, p] of this.peers) this.applyProfileTo(p);
    this.events.onLocalState?.({ ...this.state });
  }

  /**
   * Hold each sender to the budget.
   *
   * Without this a browser will happily push a megabit of 720p at every peer
   * in the room, discover the link cannot take it, and spend the next thirty
   * seconds working that out — during which the audio, sharing the same
   * connection, is unusable. Setting the ceiling in advance means it never
   * tries. `maintain-framerate` keeps speech-adjacent motion smooth and lets
   * resolution be what gives: a small sharp face reads better than a large
   * stuttering one.
   */
  private applyProfileTo(p: PeerState): void {
    const prof = this.state.profile;

    const set = (
      sender: RTCRtpSender | undefined,
      maxBitrate: number,
      maxFramerate?: number,
      degradation?: RTCDegradationPreference,
    ) => {
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = maxBitrate;
        if (maxFramerate) params.encodings[0].maxFramerate = maxFramerate;
        if (degradation) params.degradationPreference = degradation;
        void sender.setParameters(params).catch(() => {
          /* a browser that will not take these still works, just greedier */
        });
      } catch {
        /* same */
      }
    };

    set(p.slots.audio?.sender, prof.audioBitrate);
    set(
      p.slots.camera?.sender,
      prof.videoBitrate || 1,
      prof.frameRate || undefined,
      "maintain-framerate",
    );
    // A shared screen is usually words on a slide: keep them sharp and let
    // the frame rate fall instead.
    set(p.slots.screen?.sender, 800_000, 8, "maintain-resolution");
  }

  /**
   * Measure the connection and act on it.
   *
   * Loss is read from the far end's own report (remote-inbound-rtp) because
   * that is the only place that knows what actually arrived. The reading is
   * taken across every peer and the worst one wins — in a mesh, one bad link
   * is enough to make the whole call feel broken, and it is nearly always the
   * local uplink that is at fault.
   */
  /**
   * Turn two byte counts into kilobits per second, and say what is withheld.
   *
   * Rates rather than totals: a total that stopped growing ten minutes ago
   * looks identical to one that is growing now, and "is video moving RIGHT
   * NOW" is the only question this panel exists to answer.
   */
  private rateFlow(
    p: PeerState,
    bytes: { videoOut: number; audioOut: number; videoIn: number; audioIn: number },
    transport: string | null,
    framesDecoded: number,
    framesDropped: number,
  ): PeerDiagnostics {
    const now = Date.now();
    const prev = p.lastBytes;
    const seconds = prev ? (now - prev.at) / 1000 : 0;
    const kbps = (curr: number, before: number) =>
      seconds > 0 ? Math.max(0, Math.round(((curr - before) * 8) / seconds / 1000)) : 0;

    const d: PeerDiagnostics = {
      peerId: p.peerId,
      ice: p.pc.iceConnectionState,
      videoAttached: !!p.slots.camera?.sender.track,
      videoWithheld: !this.state.cameraOn
        ? "camera-off"
        : !p.wantsVideo
          ? "they-save-data"
          : null,
      videoOutKbps: prev ? kbps(bytes.videoOut, prev.videoOut) : 0,
      audioOutKbps: prev ? kbps(bytes.audioOut, prev.audioOut) : 0,
      videoInKbps: prev ? kbps(bytes.videoIn, prev.videoIn) : 0,
      audioInKbps: prev ? kbps(bytes.audioIn, prev.audioIn) : 0,
      transport,
      framesDecoded,
      framesDropped,
    };

    p.lastBytes = { at: now, ...bytes };
    return d;
  }

  /**
   * What the tile reports about its own video element.
   *
   * Pushed in from the UI because only the element knows. Kept here so the
   * diagnostics panel reads one shape from one place.
   */
  reportElement(
    peerId: string,
    element: { width: number; paused: boolean; readyState: number },
  ): void {
    const p = this.peers.get(peerId);
    if (p?.diagnostics) p.diagnostics = { ...p.diagnostics, element };
  }

  /** Everything the diagnostics panel shows, as of the last sample. */
  diagnostics(): PeerDiagnostics[] {
    return [...this.peers.values()].map(
      (p) =>
        p.diagnostics ?? {
          peerId: p.peerId,
          ice: p.pc.iceConnectionState,
          videoAttached: !!p.slots.camera?.sender.track,
          videoWithheld: null,
          videoOutKbps: 0,
          audioOutKbps: 0,
          videoInKbps: 0,
          audioInKbps: 0,
          transport: null,
          framesDecoded: 0,
          framesDropped: 0,
        },
    );
  }

  private async sampleStats(): Promise<void> {
    if (this.peers.size === 0) return;

    let worstLoss = 0;
    let worstRtt = 0;
    let available = 0;

    for (const [, p] of this.peers) {
      try {
        const stats = await p.pc.getStats();
        let sent = 0;
        let lost = 0;

        // Bytes per kind, so the panel can say which media is moving.
        const bytes = { videoOut: 0, audioOut: 0, videoIn: 0, audioIn: 0 };
        let transport: string | null = null;
        let framesDecoded = 0;
        let framesDropped = 0;

        stats.forEach((r) => {
          const report = r as unknown as Record<string, number | string>;
          if (report.type === "remote-inbound-rtp") {
            lost += Number(report.packetsLost ?? 0);
            const rtt = Number(report.roundTripTime ?? 0) * 1000;
            if (rtt > worstRtt) worstRtt = rtt;
          }
          if (report.type === "outbound-rtp") {
            sent += Number(report.packetsSent ?? 0);
            const n = Number(report.bytesSent ?? 0);
            if (report.kind === "video") bytes.videoOut += n;
            if (report.kind === "audio") bytes.audioOut += n;
          }
          if (report.type === "inbound-rtp") {
            const n = Number(report.bytesReceived ?? 0);
            if (report.kind === "video") {
              bytes.videoIn += n;
              // Bytes arriving and frames decoding are different facts, and
              // the gap between them is a whole class of bug: a stream that
              // arrives and cannot be decoded looks exactly like one that is
              // decoded and not painted.
              framesDecoded += Number(report.framesDecoded ?? 0);
              framesDropped += Number(report.framesDropped ?? 0);
            }
            if (report.kind === "audio") bytes.audioIn += n;
          }
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            const rtt = Number(report.currentRoundTripTime ?? 0) * 1000;
            if (rtt > worstRtt) worstRtt = rtt;
            const bw = Number(report.availableOutgoingBitrate ?? 0);
            if (bw > 0 && (available === 0 || bw < available)) available = bw;
          }
          if (report.type === "local-candidate" && report.candidateType) {
            transport = String(report.candidateType);
          }
        });

        p.diagnostics = this.rateFlow(p, bytes, transport, framesDecoded, framesDropped);

        // Loss since the previous sample, not since the call began — a rough
        // first ten seconds must not condemn the next hour.
        const prev = p.lastStats;
        const dSent = Math.max(0, sent - prev.packetsSent);
        const dLost = Math.max(0, lost - prev.packetsLost);
        p.lastStats = { at: Date.now(), packetsSent: sent, packetsLost: lost };
        if (prev.at > 0 && dSent + dLost > 20) {
          const pct = (dLost / (dSent + dLost)) * 100;
          if (pct > worstLoss) worstLoss = pct;
        }
      } catch {
        /* a connection that is closing has no stats to give */
      }
    }

    /*
     * Republish while we are here. Everything derived from a remote track's
     * `muted` flag depends on an event that can be missed — fired before a
     * handler was attached, or coalesced — and a roster icon stuck on "camera
     * off" for the rest of a meeting is the visible half of the bug that hid
     * the missing video. Recomputing every four seconds costs nothing and
     * means any missed edge heals itself.
     */
    for (const [peerId, p] of this.peers) this.publishMedia(peerId, p);

    const quality = rateLink({
      packetLossPct: worstLoss,
      rttMs: worstRtt,
      availableOutgoing: available,
    });

    if (quality !== this.state.quality) {
      this.state.quality = quality;
      this.applyProfile();
      void this.flush({ quality });
    }
  }

  /* ============================================================
   * Convenience wrappers over /action
   * ========================================================== */

  async action(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
    try {
      const res = await fetch(`/api/meet/${this.code}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer: this.peerId, secret: this.secret, action, ...payload }),
      });
      return await res.json();
    } catch {
      return { ok: false, error: "You're offline. That didn't go through." };
    }
  }

  /**
   * Leave, for good. Uses `sendBeacon` when the page is going away, because a
   * normal fetch is cancelled the moment the tab closes and everybody else
   * would be left looking at a tile of someone who has gone.
   */
  leave(beacon = false): void {
    const body = JSON.stringify({ peer: this.peerId, secret: this.secret });
    const url = `/api/meet/${this.code}/leave`;
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* presence will time out within the minute anyway */
      });
    }
  }

  roster(): RosterEntry[] {
    return this.rosterCache;
  }

  myPeerId(): string {
    return this.peerId;
  }
}
