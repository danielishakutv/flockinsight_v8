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
  audioShapeKey,
  audioWireBitrate,
  canShareScreen,
  isPolite,
  isPortrait,
  mediaRights,
  profileFor,
  rateLink,
  settleVerdict,
  shouldInitiate,
  tuneOpus,
  type AudioProfile,
  type BandwidthProfile,
  type MeetingQuality,
  type MeetingRole,
  type RosterEntry,
  type SignalEnvelope,
  type SignalType,
  type Stage,
} from "@/lib/meetings-shared";
import { SfuTransport } from "@/lib/meeting-sfu";

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
  /**
   * What this room lets this person turn on at all.
   *
   * Carried in the state the UI already renders from, so a locked microphone
   * is a dead button with a reason beside it rather than a button that
   * silently refuses. Recomputed from the roster on every poll, because a host
   * can promote somebody to speaker mid-meeting and the roster is the only
   * place that is authoritative about it.
   */
  rights: { mic: boolean; camera: boolean };
  /** This person's role in the room, as the server last reported it. */
  role: MeetingRole;
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
   * The voice, measured rather than guessed at.
   *
   * `audioConcealedPct` is the one that matters and the one nothing else
   * reports: the share of audio the browser had to invent because it had
   * nothing to play. That IS the complaint — "the sound keeps cutting" is a
   * concealment rate, and it tells three causes apart that look identical from
   * a seat in the meeting. High loss with low concealment is a network the
   * redundancy is already covering. Low loss with high concealment is jitter,
   * and the jitter buffer is the answer. Both low with silence on the line is
   * a microphone, not a network, and no amount of bandwidth will fix it.
   */
  audioLossPct: number;
  audioJitterMs: number;
  audioConcealedPct: number;
  /** How much audio the player is holding, ms. Rises as a link gets gusty. */
  audioJitterBufferMs: number;
  /** Whether RED is carrying a second copy of every packet to this peer. */
  audioRedundancy: boolean;
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
  /**
   * What is on the shared screen, and when the server said so.
   *
   * The timestamp is not decoration. A host puts a verse up through /action
   * and applies it from that reply, so they see it as fast as the room does —
   * and a sync response that was already in flight when they did would
   * otherwise arrive carrying the previous screen and take it back down.
   */
  onStage?: (stage: Stage, at: string) => void;
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
  onSpotlight?: (peerId: string | null, at: string) => void;
  onControl?: (payload: Record<string, unknown>) => void;
  onRecording?: (payload: Record<string, unknown>) => void;
  onEnded?: (reason: string) => void;
  onError?: (message: string) => void;
  /**
   * A camera or microphone did not open. Separate from `onError` because the
   * UI has the translator and this needs saying in the reader's language.
   */
  onMediaFault?: (fault: MediaFault, device: "microphone" | "camera") => void;
  /**
   * The microphone died mid-call and was re-opened, or could not be.
   *
   * A local track ends on its own more often than anybody expects: a headset
   * unplugged, Bluetooth handing over, Android giving the microphone to an
   * incoming call, a browser reclaiming a backgrounded tab's devices. Nothing
   * throws, no event reaches the UI, and the person goes on talking into a
   * track that no longer exists — which is exactly what "my audio cut out and
   * never came back" is. It is reported either way so that it can never again
   * be silent.
   */
  onMicInterrupted?: (outcome: "recovered" | "lost" | "unheard") => void;
  /**
   * One connection had to be thrown away and dialled again.
   *
   * Reported because the person was, until that moment, in a meeting where
   * somebody could not hear them and nothing said so. A second of silence with
   * an explanation is a different experience from a call that quietly stopped
   * working, and this is the only place the difference can be made.
   */
  onPeerRebuilt?: (peerId: string, reason: "stuck" | "voice") => void;
  /** Transport health, so the UI can say "reconnecting" honestly. */
  onTransport?: (state: "online" | "retrying" | "offline") => void;
  /**
   * This browser cannot share a screen and never will — iPhones and iPads,
   * where the method simply does not exist. Separate from `onError` so the UI
   * can point at what DOES work on that device instead of apologising.
   */
  onShareUnsupported?: () => void;
};

export type MeetingClientInit = {
  code: string;
  peerId: string;
  secret: string;
  cursor: number;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  lowData: boolean;
  /** This person's role as the server granted it at join. */
  role?: MeetingRole;
  /**
   * Whether ordinary attendees may use a microphone and a camera in this room.
   *
   * Passed in from the join response rather than assumed, and defaulted open
   * so that an older server or a failed field cannot silently gag a room.
   */
  room?: { allowAttendeeMic: boolean; allowAttendeeCamera: boolean };
  /**
   * How media travels in this room. Fixed for the meeting — see the note on
   * `meeting.transport` in the schema for why it can never change mid-call.
   */
  transport?: "mesh" | "sfu";
  events: MeetingClientEvents;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  initiator: boolean;
  /**
   * Whether this side makes the very first offer on this connection.
   *
   * The initiator does — unless the connection was created because a
   * description had already arrived for it, in which case the other side is
   * mid-offer and a second one is a collision at the worst moment.
   */
  mayOfferFirst: boolean;
  /** When this connection was made, so a reset meant for its predecessor can be told apart. */
  createdAt: number;
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
  /**
   * The previous audio sample, for the same reason: concealment and loss are
   * cumulative counters, and a call that was rough for its first ten seconds
   * must not read as rough for the next hour.
   */
  lastAudio: {
    packetsReceived: number;
    packetsLost: number;
    concealedSamples: number;
    totalSamples: number;
  } | null;
  /** The concealment share from the last sample, for the link verdict. */
  lastConcealedPct: number;
  /**
   * When this peer was last re-offered purely to change the audio shape, and
   * which shape that offer actually carried.
   *
   * Turning RED on or off needs a new offer, and a link that flaps between
   * "fair" and "good" would otherwise renegotiate every few seconds — which
   * costs more than the redundancy is worth and risks a glare storm in a room
   * where everybody's link is flapping at once. So there is a cooldown.
   *
   * Both are PER PEER, and that is the whole point. A single "the room is
   * now using RED" flag plus a cooldown was wrong in a way that was easy to
   * miss: the flag would be set, the cooldown would skip the offer, and the
   * shape would then count as applied to a peer that had never been told
   * about it — silently, for the rest of the call. Somebody toggling Data
   * Saver within half a minute of joining hit exactly that.
   */
  audioOfferedAt: number;
  /**
   * The shape the last COMPLETED negotiation on this connection carried.
   *
   * Committed when signalling returns to "stable", never when an offer is
   * merely sent. An offer can be ignored by the other side, rolled back, or
   * refused outright, and claiming the shape at the moment it went out means a
   * connection that never heard about it is marked as having it — so nothing
   * ever tries again. That is the same silent failure twice over, and this
   * time it cost a meeting.
   */
  audioShape: string;
  /** The shape an offer or answer is carrying right now. Committed on stable. */
  audioShapePending: string | null;
  /**
   * When this connection last left "stable", or null while it is there.
   *
   * A pair whose m-lines have fallen out of step rejects every description
   * either side builds, and sits in `have-local-offer` / `have-remote-offer`
   * for the rest of the call with one direction of audio dead and nothing on
   * screen to say so. This is how that is noticed.
   */
  unstableSince: number | null;
  /**
   * The chain every description on this connection goes through, in turn.
   *
   * Building an offer and answering an incoming one are both several awaits
   * long — `createOffer`, `createAnswer` — and they used to be able to
   * interleave, because offers are started with `void makeOffer(...)` while
   * incoming signals are handled in their own loop. Half way through
   * answering somebody's offer, our own `setLocalDescription` would land, and
   * the answer we then tried to set was refused for being in the wrong state.
   * The peer had asked a question that was never answered, and waited.
   *
   * One connection, one negotiation at a time. The state read at the top of a
   * step is then still the state when the step runs.
   */
  negotiating: Promise<void>;
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
/**
 * The least time between two rebuilds of one connection for the voice's sake.
 *
 * A minute, not the half minute an offer used to cost, because a rebuild costs
 * that pair about a second of media rather than a quiet exchange of
 * descriptions. A link flapping between "fair" and "good" must not be able to
 * spend that second over and over.
 */
const AUDIO_RESHAPE_MS = 60_000;
/**
 * How long a connection may sit mid-negotiation before it is rebuilt.
 *
 * A healthy offer/answer completes in well under a second, and a slow one on a
 * rural link in a few. Fifteen seconds is not slow, it is stuck — and a stuck
 * connection never recovers on its own, because every path out of it starts
 * with a description the other side will reject.
 */
const NEGOTIATION_WEDGE_MS = 15_000;
/** Rebuilds of one peer connection before giving up on recovering it. */
const PEER_RESET_LIMIT = 4;
/**
 * Rebuilds spent on the VOICE alone, which is a comfort rather than the call.
 *
 * Its own budget, because sharing one with recovery meant a few ordinary
 * quality wobbles could leave a connection that later broke with no way back.
 */
const VOICE_RESHAPE_LIMIT = 2;
/**
 * How long a new connection ignores a request to throw itself away.
 *
 * Both sides of a broken pair usually notice at the same moment, so both send
 * the request and both rebuild. The second request then arrives at the
 * connection that has just replaced the one it was about, and acting on it
 * discards a perfectly good connection — which produces another request, and
 * another. Measured as a pair ping-ponging ten rebuilds deep until the cap
 * stopped it, with one direction dead at the end. A few seconds of deafness to
 * requests is all it takes: anything in flight when a connection is made was
 * written about its predecessor.
 */
const RESET_GRACE_MS = 4_000;
/** How many times a microphone that dies mid-call will be re-opened. */
const MIC_RECOVERY_LIMIT = 6;
/**
 * How long a capture track may stay muted before it is treated as lost.
 *
 * An operating system mutes a microphone for a moment while a device changes
 * hands, which is normal. Four seconds of it is not.
 */
const MIC_MUTE_GRACE_MS = 4_000;
/** How long a recovered microphone must hold before its allowance is forgiven. */
const MIC_FORGIVE_MS = 120_000;
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
  /**
   * Set the moment the call is over for this browser, so the ending is
   * announced exactly once. A poll already in flight, a queued flush and the
   * host's own button can all arrive at the same conclusion a moment apart.
   */
  private ending = false;
  private listening: AbortController | null = null;

  private peers = new Map<string, PeerState>();
  private media = new Map<string, RemoteMedia>();
  private rosterCache: RosterEntry[] = [];

  private micStream: MediaStream | null = null;
  /** Which way up the camera was last asked for — see `handleRotation`. */
  private capturedPortrait = false;
  /**
   * Everything this connection has moved, across every peer or the SFU.
   *
   * Reported to the server with the ordinary state push, so usage is measured
   * rather than estimated. `received` is the half that costs money: the media
   * server bills what leaves its edge for a client.
   */
  private totals = { received: 0, sent: 0 };
  /**
   * The SFU, when this room uses one. Null on a mesh room, and every
   * peer-to-peer code path below returns early when it is set — the two
   * transports never interleave.
   */
  private sfu: SfuTransport | null = null;
  private readonly transport: "mesh" | "sfu";
  private camStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  private state: LocalState;
  private outbox: { to?: string | null; type: SignalType; payload: Record<string, unknown> }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private retryDelay = RETRY_BASE_MS;

  /** What this room allows an ordinary attendee. See `mediaRights`. */
  private readonly room: { allowAttendeeMic: boolean; allowAttendeeCamera: boolean };

  /** How many times the microphone has been re-opened after dying. */
  private micRecoveries = 0;
  /** Whether this browser has been found to refuse a jitter buffer hint. */
  private jitterBufferRefused = false;
  /** The previous outgoing-voice reading, for turning totals into a rate. */
  private lastOutgoingVoice: {
    at: number;
    bytesSent: number;
    packetsSent: number;
    audioEnergy: number;
    audioLevel: number;
  } | null = null;
  /** A verdict waiting to be confirmed by a second sample. See settleQuality. */
  private qualityCandidate: { quality: MeetingQuality; samples: number } | null = null;
  private micMuteTimer: ReturnType<typeof setTimeout> | null = null;
  private micForgiveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Signal ids already acted on, so a duplicate delivery cannot act twice. */
  private seenSignals = new Set<number>();
  /**
   * The signal cursor at the moment each peer was last thrown away.
   *
   * Anything written before that cannot be about the connection that replaced
   * it, which is the only way to tell a stale offer from a fresh one: the ids
   * come from one Postgres sequence, so they are ordered across the room.
   * Without this, an answer or a candidate written about the connection that
   * was just discarded is applied to its replacement, and the replacement is
   * broken in exactly the way the discard was meant to repair.
   */
  private droppedAt = new Map<string, number>();
  /** Rebuilds spent recovering a connection, and rebuilds spent on the voice. */
  private recoveryResets = new Map<string, number>();
  private voiceResets = new Map<string, number>();
  /** Consecutive samples where the microphone was heard but nothing was sent. */
  private voiceSilentStrikes = 0;
  private voiceSilenceReported = false;
  /**
   * Rebuilds forced on each peer by a wedged negotiation.
   *
   * Kept out here rather than on `PeerState`, because the rebuild deletes the
   * peer — a counter living on it would reset itself every time and the cap
   * would never be reached.
   */

  private onDeviceChange: (() => void) | null = null;

  constructor(init: MeetingClientInit) {
    this.code = init.code;
    this.peerId = init.peerId;
    this.secret = init.secret;
    this.cursor = init.cursor;
    this.events = init.events;
    this.transport = init.transport ?? "mesh";
    this.rtcConfig = {
      iceServers: init.iceServers,
      iceTransportPolicy: init.iceTransportPolicy ?? "all",
      // A handful of candidates is plenty on a mesh and gathering fewer gets
      // the first one out sooner, which is what the person waiting notices.
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
    this.room = init.room ?? { allowAttendeeMic: true, allowAttendeeCamera: true };
    const role = init.role ?? "attendee";
    const profile = profileFor({ peers: 1, lowData: init.lowData });
    this.state = {
      micOn: false,
      cameraOn: false,
      sharing: false,
      lowData: init.lowData,
      quality: "good",
      profile,
      facing: "user",
      role,
      rights: mediaRights(role, this.room),
    };
  }

  /* ============================================================
   * Lifecycle
   * ========================================================== */

  /**
   * The SFU's view of the room, assembled into the same `RemoteMedia` shape the
   * mesh produces — so the room component, the tiles, the recorder and the
   * speaking detector all carry on unchanged. A transport is an implementation
   * detail of this class and of nothing above it.
   */
  private buildSfu(): SfuTransport {
    return new SfuTransport(
      async (action, body) => {
        const res = await fetch(`/api/meet/${this.code}/sfu`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            peer: this.peerId,
            secret: this.secret,
            action,
            ...body,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok || data.ok === false) {
          throw new Error(String(data.error ?? `sfu ${action} failed`));
        }
        return data;
      },
      this.rtcConfig.iceServers ?? [],
      // Read through a function rather than passed by value: the profile
      // changes as the link is measured, and the transport asks for whatever
      // is current at the moment it negotiates.
      () => this.state.profile.audio,
      {
        onMedia: (peerId, bundle) => {
          const screen = bundle.screen.getVideoTracks().length > 0;
          this.media.set(peerId, {
            peerId,
            stream: bundle.stream,
            hasAudio: bundle.stream.getAudioTracks().length > 0,
            hasCamera: bundle.stream.getVideoTracks().length > 0,
            hasScreen: screen,
            screenStream: screen ? bundle.screen : null,
          });
          this.events.onMedia?.(new Map(this.media));
        },
        onGone: (peerId) => {
          this.media.delete(peerId);
          this.events.onMedia?.(new Map(this.media));
        },
        onState: (state) => {
          if (state === "failed") this.events.onTransport?.("retrying");
        },
        onError: (message) => this.events.onError?.(message),
      },
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.listenLoop();
    this.statsTimer = setInterval(() => void this.sampleStats(), STATS_INTERVAL_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }

    /*
     * A headset being unplugged, or Bluetooth handing back to the earpiece,
     * ends the microphone track without any error anywhere. Checked here as
     * well as on the track's own `ended` event because on some Android
     * builds only one of the two fires.
     */
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      this.onDeviceChange = () => this.checkMicAlive();
      navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);
    }
  }

  /**
   * Shut everything down, in an order that does not leave a camera light on.
   * Safe to call more than once — React will, in development.
   */
  async stop(): Promise<void> {
    this.sfu?.close();
    this.sfu = null;

    /*
     * No early exit. This used to return when nothing was running and there
     * were no peers — which is exactly the state of somebody alone in a room,
     * so their camera and microphone were never released and the indicator
     * light stayed on after they had left. Everything below is idempotent, so
     * running it twice costs nothing and running it once is the whole point.
     */
    this.running = false;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (this.onDeviceChange && typeof navigator !== "undefined") {
      navigator.mediaDevices?.removeEventListener("devicechange", this.onDeviceChange);
      this.onDeviceChange = null;
    }
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // A timer that fires after the call has ended would re-open a microphone
    // for a meeting this browser has left.
    if (this.micMuteTimer) clearTimeout(this.micMuteTimer);
    if (this.micForgiveTimer) clearTimeout(this.micForgiveTimer);
    this.micMuteTimer = this.micForgiveTimer = null;
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
   * The meeting is over for this browser: say why, once, and let go of
   * everything.
   *
   * This used to stop the listening loop and tell the interface, and nothing
   * else — which is not the same as leaving. On a mesh the peer connections are
   * DIRECT, so a room whose signalling had stopped carried on sending pictures
   * and sound between the people still in it, with every camera light on,
   * behind a screen that said the meeting had ended. "End for everyone" has to
   * mean ended: the connections close and the devices are released here, in the
   * engine, so it happens the same way whichever of the four endings it was —
   * the host's button, a removal, the housekeeping cron, or a stale session.
   */
  private shutdown(reason: string): void {
    if (this.ending) return;
    this.ending = true;
    this.running = false;
    this.events.onEnded?.(reason);
    void this.stop().catch((e) => {
      // Nothing above can act on this, but a camera that would not release is
      // exactly the kind of thing that must not fail in silence.
      console.error("[meeting] teardown after the call ended did not finish", e);
    });
  }

  /**
   * End it for this browser, on this browser's own initiative — leaving, or a
   * host who has just ended it for the room. Shares the one-way door with every
   * other ending, so a poll landing a moment later cannot overwrite the reason
   * the person was given.
   */
  endLocally(reason: string): void {
    this.shutdown(reason);
  }

  /** Whether this client has already been shut down. */
  get finished(): boolean {
    return this.ending;
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
          this.shutdown("You were signed out of this meeting.");
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
      bytesReceived: this.totals.received,
      bytesSent: this.totals.sent,
    });
  }

  private async consume(data: {
    cursor?: number;
    signals?: SignalEnvelope[];
    roster?: RosterEntry[];
    stage?: Stage;
    /** The server's clock when this answer was built. Orders room state. */
    serverTime?: string;
    spotlightPeerId?: string | null;
    ended?: boolean;
    removed?: boolean;
    waitingForHost?: boolean;
  }): Promise<void> {
    /*
     * Nothing after the call has ended.
     *
     * A poll that was already in flight when `stop()` ran still resolves here
     * a moment later, and `stop()` has by then emptied the peer map — so this
     * would read the roster it was holding, decide it has nobody connected,
     * and dial the whole room again. New peer connections, new signals posted,
     * for a meeting this browser has left.
     */
    if (!this.running) return;

    if (typeof data.cursor === "number" && data.cursor > this.cursor) {
      this.cursor = data.cursor;
    }
    if (data.removed) {
      this.shutdown("You were removed from this meeting.");
      return;
    }
    if (data.ended) {
      this.shutdown("This meeting has ended.");
      return;
    }
    /*
     * The server's clock, or this instant if an older server did not send one.
     * Falling back to "now" keeps the ordering guard from rejecting
     * everything, which would freeze the shared screen rather than merely
     * leave it unordered.
     */
    const at = data.serverTime ?? new Date().toISOString();
    if (data.stage) this.events.onStage?.(data.stage, at);
    // Always, including when it is null: clearing has to travel too.
    if ("spotlightPeerId" in data) {
      this.events.onSpotlight?.(
        typeof data.spotlightPeerId === "string" ? data.spotlightPeerId : null,
        at,
      );
    }
    if (data.roster) {
      this.rosterCache = data.roster;
      this.applyMyRole(data.roster);
      this.events.onRoster?.(data.roster);
      this.reconcilePeers(data.roster);
    }
    /*
     * Not awaited, and that matters more than it looks.
     *
     * Handling a description now goes through that peer's negotiation queue,
     * so awaiting it here put the whole of signalling behind one connection's
     * negotiation: a step that never settled — and closing a peer connection
     * mid-step is exactly that — stopped every signal for every peer for the
     * rest of the call. Ordering is still kept where ordering matters, because
     * descriptions and candidates for one peer go through that peer's own
     * queue in arrival order.
     */
    for (const s of data.signals ?? []) {
      if (this.alreadyHandled(s)) continue;
      void this.handleSignal(s);
    }
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
  /**
   * Read this person's own role back off the roster, and act on it.
   *
   * The role is not fixed for the call: a host can make somebody a speaker so
   * they can give their testimony, and make them an attendee again afterwards.
   * Taken from the roster rather than from the `control` signal that announces
   * it, for the reason the rest of this file already settles on — a signal can
   * be missed and is then missed for ever, while the roster arrives on every
   * poll and repairs anything that went astray within seconds.
   *
   * Losing the right to speak takes the microphone with it. Not doing that
   * would leave somebody live in a room that believes it has silenced them,
   * which is the worst of the available outcomes.
   */
  private applyMyRole(roster: RosterEntry[]): void {
    const mine = roster.find((r) => r.peerId === this.peerId);
    if (!mine) return;

    const rights = mediaRights(mine.role, this.room);
    const changed =
      mine.role !== this.state.role ||
      rights.mic !== this.state.rights.mic ||
      rights.camera !== this.state.rights.camera;
    if (!changed) return;

    this.state.role = mine.role;
    this.state.rights = rights;

    if (!rights.mic && this.state.micOn) void this.setMic(false);
    if (!rights.camera && this.state.cameraOn) void this.setCamera(false);
    this.events.onLocalState?.({ ...this.state });
  }

  private reconcilePeers(roster: RosterEntry[]): void {
    if (this.transport === "sfu") {
      // No peers to dial. The roster says who is publishing and where, and the
      // transport pulls whatever it has not already got.
      this.sfu ??= this.buildSfu();
      void this.sfu.sync(roster, this.peerId).catch((e) => {
        console.error("[sfu] sync failed", e);
      });
      return;
    }

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

  /**
   * `answering` means this connection exists because a description arrived for
   * it, so the other side is already offering and this one must not.
   *
   * Without it there is a collision built into the start of every call that
   * happens to arrive out of order: an offer reaches us before the roster
   * naming its sender does, we create the connection here, and because we are
   * the initiator we offer too — into an offer already in flight. Perfect
   * negotiation then rolls one back, and a rollback is what leaves the two
   * sides disagreeing about the order of their m-lines, which is fatal and
   * silent. Measured at roughly one room in five before this line existed.
   */
  private createPeer(peerId: string, opts: { answering?: boolean } = {}): PeerState {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const initiator = shouldInitiate(this.peerId, peerId);

    const p: PeerState = {
      pc,
      polite: isPolite(this.peerId, peerId),
      initiator,
      mayOfferFirst: initiator && opts.answering !== true,
      createdAt: Date.now(),
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
      lastAudio: null,
      lastConcealedPct: 0,
      /*
       * Dated to now and seeded with the shape this connection is about to
       * negotiate with: its first offer carries the current profile, so there
       * is nothing to change yet, and the cooldown starts from the moment the
       * peer exists rather than from 1970.
       */
      audioOfferedAt: Date.now(),
      audioShape: audioShapeKey(this.state.profile.audio),
      audioShapePending: null,
      unstableSince: null,
      negotiating: Promise.resolve(),
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

    /*
     * An offer is made for exactly one reason: this side has a transceiver
     * with nowhere to live.
     *
     * A connection carries SIX m-lines, three per direction, because each side
     * creates its own microphone, camera and screen transceivers. An answer
     * can never add an m-line — so the side that did not make the first offer
     * ends up with three transceivers and no m-lines for them, and until it
     * offers it can hear everybody while nobody can hear it. That is what this
     * event is for, and `mid === null` is the whole of the question.
     *
     * Everything else is refused, and that is the fix for the bug this file
     * has been rewritten around. The old rule was "later renegotiations may
     * come from either side; perfect negotiation sorts those out". It does not.
     * Perfect negotiation resolves a collision by rolling an offer back, and a
     * rollback leaves transceivers behind — so a pair that collides repeatedly
     * ends up with its m-lines in different orders on the two sides, after
     * which every description either one builds is refused by the other:
     *
     *     The order of m-lines in answer doesn't match order in offer
     *
     * and that pair's audio is finished for the rest of the call, silently.
     * Answering an offer can itself raise this event, so "both sides may
     * offer" is a loop rather than an unlucky coincidence. Once every
     * transceiver has an m-line, an offer from here would add nothing and risk
     * exactly that, so none is made: a change of audio shape goes through
     * `renegotiateAudioIfNeeded`, which nominates one offerer per pair.
     */
    pc.onnegotiationneeded = () => {
      // The first offer belongs to the initiator alone — both sides learn
      // about each other at the same instant, and two simultaneous first
      // offers are a collision for no reason.
      if (!p.negotiated) {
        if (p.mayOfferFirst) void this.makeOffer(peerId, p);
        return;
      }
      const homeless = [p.slots.audio, p.slots.camera, p.slots.screen].some(
        (t) => t && t.mid === null,
      );
      if (!homeless) return;
      void this.makeOffer(peerId, p);
    };

    /*
     * Two jobs, both about not lying to ourselves.
     *
     * Reaching "stable" is the only moment at which an audio shape has really
     * been agreed, so that is where it is written down. And leaving "stable"
     * starts a clock, because a negotiation that never comes back is the shape
     * of bug that killed one direction of a call and said nothing.
     */
    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== "stable") {
        p.unstableSince ??= Date.now();
        return;
      }
      p.unstableSince = null;
      if (p.audioShapePending !== null) {
        p.audioShape = p.audioShapePending;
        p.audioShapePending = null;
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") this.recoverIce(peerId, p);
      if (s === "disconnected") {
        // Give it a few seconds: "disconnected" is frequently a phone changing
        // masts and recovers by itself. Acting immediately would throw away a
        // connection that was about to come back.
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") this.recoverIce(peerId, p);
        }, 4000);
      }
    };

    this.attachLocalTracks(p);
    return p;
  }

  /**
   * Run one negotiation step on a connection, after any already in progress.
   *
   * Offers are started with `void`, from a stats tick or a peer's request,
   * while incoming descriptions arrive in the listen loop — so without this
   * the two interleave, and a step that checked the signalling state at its
   * first line finds a different one by its third. That is how an answer came
   * to be refused for being in the wrong state while the peer who had asked
   * the question sat waiting for it.
   *
   * The chain is never allowed to reject: each step handles its own failure,
   * and anything that still escapes is reported rather than silently stopping
   * every later step on that connection.
   */
  private negotiate(p: PeerState, step: () => Promise<void>): Promise<void> {
    p.negotiating = p.negotiating.then(step, step).catch((e) => {
      console.error("[meeting] a negotiation step failed outright", e);
    });
    return p.negotiating;
  }

  private makeOffer(peerId: string, p: PeerState): Promise<void> {
    return this.negotiate(p, async () => {
      try {
        p.makingOffer = true;
        const audio = this.state.profile.audio;
        const offer = await p.pc.createOffer();
        if (offer.sdp) offer.sdp = tuneOpus(offer.sdp, audio);
        // Pending, not applied: it becomes this connection's shape when
        // signalling reaches "stable", and not before.
        p.audioShapePending = audioShapeKey(audio);
        await p.pc.setLocalDescription(offer);
        this.send("offer", { sdp: p.pc.localDescription?.toJSON() }, peerId);
      } catch (e) {
        p.audioShapePending = null;
        console.error("[meeting] offer failed", e);
      } finally {
        p.makingOffer = false;
      }
    });
  }

  /**
   * An ICE restart re-gathers candidates on the existing connection, which is
   * what recovers a call after a network change — far faster and far less
   * disruptive than tearing the peer down and starting again. Capped, because
   * a peer that has genuinely gone should not be retried forever.
   */
  private recoverIce(peerId: string, p: PeerState): void {
    if (!this.running) return;
    if (this.peers.get(peerId) !== p) return;

    /*
     * Rebuilt rather than ICE-restarted, and that is a correction.
     *
     * An ICE restart is a new offer, and only one side of a pair is allowed to
     * offer now — so `restartIce` quietly did nothing at all on the other
     * half of every connection. `pc.restartIce()` raises
     * `negotiationneeded`, the guard there sees every transceiver already has
     * an m-line, and the event is dropped. The polite side therefore burned
     * its retry budget five times and recovered nothing, which is a worse
     * failure than the one the guard was added to prevent.
     *
     * A rebuild needs no renegotiation, works from either side, tells the
     * other end, and is capped — the same machinery that recovers a wedged
     * negotiation. ICE restart is an optimisation; being able to recover at
     * all is not.
     */
    this.rebuildPeer(peerId, p, "ice");
  }

  /* ============================================================
   * Signals in
   * ========================================================== */

  /**
   * Has this exact signal already been dealt with?
   *
   * The long poll and a state push are two requests to the same endpoint, and
   * both hand their answer to `consume`. A signal that lands while a push is
   * in flight comes back in both, with the same id — so it used to be
   * processed twice. A duplicated offer was accepted as a genuine mid-call
   * renegotiation, which is the very thing yesterday's work removed, and a
   * duplicated "renegotiate" threw away a connection that had just been built
   * to replace the one the first copy asked about.
   *
   * Ids come from a Postgres sequence, so they are unique and ordered. The set
   * is trimmed because a long service is tens of thousands of them.
   */
  private alreadyHandled(s: SignalEnvelope): boolean {
    if (typeof s.id !== "number") return false;
    if (this.seenSignals.has(s.id)) return true;
    this.seenSignals.add(s.id);
    if (this.seenSignals.size > 4000) {
      // Oldest first, which for a Set is insertion order.
      const keep = [...this.seenSignals].slice(-2000);
      this.seenSignals = new Set(keep);
    }
    return false;
  }

  /**
   * Was this written before the connection it names was thrown away?
   *
   * See `droppedAt`. A description or a candidate from before the discard
   * describes something that no longer exists, and applying it to the fresh
   * connection is how a rebuild produced a connection as broken as the one it
   * replaced.
   */
  private writtenBeforeThisConnection(s: SignalEnvelope): boolean {
    const dropped = this.droppedAt.get(s.fromPeer);
    if (dropped === undefined) return false;
    if (typeof s.id !== "number") return false;
    if (s.id > dropped) return false;
    console.info(
      `[meeting] ignoring a ${s.type} from ${s.fromPeer} written before that ` +
        `connection was thrown away`,
    );
    return true;
  }

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
        /*
         * Who is leaving, which is not always the sender.
         *
         * A tab saying goodbye for itself sends no payload, so the sender is
         * the one going. But the join route also posts a `bye` for every
         * session a returning device has just retired — "this phone was
         * already in the room, drop the old tile" — and there the sender is
         * the NEW peer while the one to forget is named in the payload.
         * Reading `fromPeer` for both meant that signal closed the connection
         * to the person who had just walked in, and left the stale tile it was
         * sent to clear.
         */
        const leaving =
          typeof s.payload.peerId === "string" ? s.payload.peerId : s.fromPeer;
        if (leaving === this.peerId) return;
        const p = this.peers.get(leaving);
        if (p) this.dropPeer(leaving, p);
        else {
          this.media.delete(leaving);
          this.events.onMedia?.(new Map(this.media));
        }
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
      case "renegotiate": {
        /*
         * "I have thrown this connection away; throw yours away too."
         *
         * Sent for two reasons — a negotiation that got stuck, and a voice
         * that now wants a shape the running connection cannot be given — and
         * handled identically, because the answer to both is the same fresh
         * connection. Both sides have to forget it: a new offer arriving at
         * the old connection is a renegotiation, which is the thing being
         * avoided. The next roster poll dials them again from nothing.
         */
        const p = this.peers.get(s.fromPeer);
        if (!p) return;

        // Sent about the connection this one replaced. See RESET_GRACE_MS.
        const age = Date.now() - p.createdAt;
        if (age < RESET_GRACE_MS) {
          console.info(
            `[meeting] ignoring ${s.fromPeer}'s request to start again: this ` +
              `connection is ${age}ms old, so the request was about the one ` +
              `before it.`,
          );
          return;
        }

        console.info(
          `[meeting] ${s.fromPeer} has dropped its connection to us and asked ` +
            `for a new one. Rebuilding ours to match.`,
        );
        this.dropPeer(s.fromPeer, p);
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
        this.events.onStage?.(s.payload as unknown as Stage, s.at);
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
        s.at,
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
      this.shutdown("The host removed you from the meeting.");
      return;
    }
    if (action === "ended") {
      this.shutdown("The host ended the meeting.");
      return;
    }
    this.events.onControl?.(s.payload);
  }

  private onDescription(s: SignalEnvelope): Promise<void> {
    const raw = s.payload.sdp as RTCSessionDescriptionInit | undefined;
    if (!raw?.type) return Promise.resolve();
    if (this.writtenBeforeThisConnection(s)) return Promise.resolve();
    const p =
      this.peers.get(s.fromPeer) ??
      this.createPeer(s.fromPeer, { answering: raw.type === "offer" });

    // Behind whatever this connection is already doing. Reading the signalling
    // state and then acting on it is only sound if nothing else can change it
    // in between, and offers are started from elsewhere without being awaited.
    return this.negotiate(p, async () => {
      try {
        const offerCollision =
          raw.type === "offer" && (p.makingOffer || p.pc.signalingState !== "stable");

        // Perfect negotiation, as specified: the impolite peer ignores a
        // colliding offer and keeps its own; the polite peer rolls back and
        // accepts. Exactly one of the pair is polite, so they never both give
        // way and never both insist.
        p.ignoreOffer = !p.polite && offerCollision;
        if (p.ignoreOffer) return;

        /*
         * An answer to an offer we no longer have.
         *
         * Perfect negotiation rolls our own offer back when a colliding one
         * arrives, and the answer to that rolled-back offer turns up a moment
         * later. Handing it to `setRemoteDescription` throws "Called in wrong
         * state: stable" — which was caught, logged where nobody was looking,
         * and left the connection to be sorted out by nothing. It is not an
         * error: the offer it answers genuinely no longer exists, so the right
         * thing to do with it is nothing at all.
         */
        if (raw.type === "answer" && p.pc.signalingState !== "have-local-offer") {
          p.audioShapePending = null;
          return;
        }

        await p.pc.setRemoteDescription(raw);
        p.negotiated = true;

        if (raw.type === "offer") {
          const audio = this.state.profile.audio;
          const answer = await p.pc.createAnswer();
          if (answer.sdp) answer.sdp = tuneOpus(answer.sdp, audio);
          /*
           * The answerer's shape counts too. What a peer SENDS is decided by
           * the description it sets locally, so answering is this side
           * agreeing a shape just as much as offering is — and recording it
           * here is what stops the nominated-offerer arrangement below from
           * asking for the same change every thirty seconds for the rest of
           * the meeting.
           */
          p.audioShapePending = audioShapeKey(audio);
          await p.pc.setLocalDescription(answer);
          this.send("answer", { sdp: p.pc.localDescription?.toJSON() }, s.fromPeer);
        }

        this.applyProfileTo(p);
        if (this.state.lowData) this.send("pause", { video: false }, s.fromPeer);
      } catch (e) {
        p.audioShapePending = null;

        /*
         * Two very different things end up here, and calling both
         * "negotiation failed" is how the second one hid for as long as it did.
         *
         * A description that arrived for a negotiation that no longer exists
         * is ordinary. The guards above catch most of them, but not all: a
         * browser runs these calls through its own operations queue too, so a
         * description can go stale between being handed over and being
         * applied. Nothing is wrong and nothing needs doing — and shouting
         * about it buries the real thing.
         *
         * A description REFUSED on its merits — "the order of m-lines in
         * answer doesn't match order in offer" — is the real thing. There is
         * no description either side can build after that, so there is
         * nothing to retry: it is left to the wedge watchdog in
         * `sampleStats`, which throws the connection away and dials again.
         */
        const message = e instanceof Error ? e.message : String(e);
        if (/wrong state/i.test(message)) {
          console.info(
            `[meeting] a ${raw.type} from ${s.fromPeer} arrived for a ` +
              `negotiation that had already moved on (now ` +
              `"${p.pc.signalingState}"). Ignored.`,
          );
          return;
        }
        /*
         * Refused on its merits, which means this connection is finished.
         *
         * Once the two sides disagree about the order of their m-lines there
         * is no description either can build that the other will accept, so
         * waiting is just silence: rebuilt now rather than in fifteen seconds
         * when the watchdog would have noticed. The watchdog stays as the net
         * for the other way this ends — a negotiation that never completes and
         * never fails either.
         */
        console.error(
          `[meeting] ${s.fromPeer} sent a ${raw.type} this connection will ` +
            `not accept, in state "${p.pc.signalingState}". Rebuilding it now.`,
          e,
        );
        this.rebuildPeer(s.fromPeer, p, "refused");
      }
    });
  }

  private async onCandidate(s: SignalEnvelope): Promise<void> {
    const p = this.peers.get(s.fromPeer);
    if (!p) return;
    const candidate = s.payload.candidate as RTCIceCandidateInit | undefined;
    if (!candidate) return;
    if (this.writtenBeforeThisConnection(s)) return;
    // Behind this peer's descriptions. A candidate applied before the
    // description it belongs to is refused, and the refusal used to be the
    // only sign that the two had been handled out of order.
    await this.negotiate(p, async () => {
      try {
        await p.pc.addIceCandidate(candidate);
      } catch (e) {
        if (!p.ignoreOffer) console.warn("[meeting] candidate rejected", e);
      }
    });
  }

  /**
   * Which of the three slots an arriving track belongs to.
   *
   * There are TWO video transceivers per peer — camera and screen — and
   * telling them apart is the whole job. Getting it wrong does not look like a
   * mix-up; it looks like video being broken, because the idle screen track
   * displaces the camera and the element is handed something that will never
   * carry a frame.
   *
   * Identity first, which holds whenever the browser reused the transceivers
   * we created. Then `mid`, which is the negotiated name of the m-line and is
   * the same string on both sides of the call — so even a transceiver the
   * browser made for itself lands in the right slot.
   *
   * The old last resort was `kind === "audio" ? "audio" : "camera"`, which sent
   * BOTH video tracks to the camera slot. That is what caused this: the screen
   * track arrived second, resolved to camera, and evicted a camera track that
   * was mid-picture. Now an unidentifiable video track goes to whichever video
   * slot is still free, and to screen if both are taken, so it can never evict
   * the camera.
   */
  private slotFor(p: PeerState, e: RTCTrackEvent): TrackSlot {
    if (e.transceiver === p.slots.audio) return "audio";
    if (e.transceiver === p.slots.camera) return "camera";
    if (e.transceiver === p.slots.screen) return "screen";

    const mid = e.transceiver.mid;
    if (mid !== null && mid !== undefined) {
      if (mid === p.slots.audio?.mid) return "audio";
      if (mid === p.slots.camera?.mid) return "camera";
      if (mid === p.slots.screen?.mid) return "screen";
    }

    if (e.track.kind === "audio") return "audio";
    return p.stream.getVideoTracks().length === 0 ? "camera" : "screen";
  }

  private onRemoteTrack(peerId: string, p: PeerState, e: RTCTrackEvent): void {
    const resolved = this.slotFor(p, e);
    const target = resolved === "screen" ? p.screenStream : p.stream;

    /*
     * Replace rather than accumulate — but never let a track that is not
     * carrying anything displace one that is.
     *
     * A track arrives muted, meaning no media yet, and it may stay that way
     * for ever if the far end is not sending on that transceiver. The old code
     * evicted the incumbent unconditionally, so an idle second video track
     * replaced a camera that was mid-picture: the receiver went on decoding
     * hundreds of frames into a track nothing held, and the video element was
     * left with one that never produced a pixel. From the outside that is an
     * avatar and a healthy `getStats`, which is a miserable thing to debug.
     */
    const others = target
      .getTracks()
      .filter((t) => t.kind === e.track.kind && t.id !== e.track.id);
    const incomingIsIdle = e.track.muted;
    const working = others.filter((t) => !t.muted && t.readyState === "live");

    if (incomingIsIdle && working.length > 0) {
      // Keep what is working. If this one ever starts carrying media its own
      // `unmute` brings it back through here, and by then it can win.
      e.track.onunmute = () => this.onRemoteTrack(peerId, p, e);
      return;
    }

    for (const t of others) target.removeTrack(t);
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
    /*
     * Heal a video track that was guessed into the wrong slot.
     *
     * Slotting is by transceiver identity and then by `mid`, and both are
     * reliable — but there is still a last resort that guesses, and a wrong
     * guess here is expensive: a camera in the screen slot is a blank tile and
     * a phantom "sharing their screen", which is precisely the shape of bug
     * that has taken all day.
     *
     * So it is checked against what the person says they are doing. If they
     * are not sharing a screen, nothing belongs in their screen slot, and a
     * track carrying pictures there is their camera in the wrong place. Moving
     * it is cheap and the condition is narrow enough that it cannot fire on a
     * real share.
     */
    const theirs = this.rosterCache.find((r) => r.peerId === peerId);
    if (theirs && !theirs.sharing) {
      const stranded = p.screenStream
        .getVideoTracks()
        .filter((t) => t.readyState === "live" && !t.muted);
      const cameraIsEmpty = !p.stream
        .getVideoTracks()
        .some((t) => t.readyState === "live" && !t.muted);

      if (stranded.length > 0 && cameraIsEmpty) {
        for (const t of stranded) {
          p.screenStream.removeTrack(t);
          p.stream.addTrack(t);
        }
      }
    }

    /*
     * Do not play what this room does not allow this person to send.
     *
     * On a mesh there is no server in the media path, so "only the platform
     * may speak" cannot be enforced by refusing to relay — the packets arrive
     * directly. The server refuses to RECORD an attendee as unmuted and the
     * sending browser refuses to turn the microphone on, which covers every
     * ordinary case; this covers the rest, and it is what makes the setting a
     * rule rather than a convention.
     *
     * Fails open on purpose. An unknown peer, or a roster that has not arrived
     * yet, is treated as allowed: muting somebody who should be heard is a
     * worse mistake than briefly hearing somebody who should not be, and a
     * promotion to speaker heals here within one poll because this runs again
     * on every stats tick.
     */
    const allowed = theirs ? mediaRights(theirs.role, this.room) : { mic: true, camera: true };

    const audio =
      allowed.mic && p.stream.getAudioTracks().some((t) => !t.muted);
    const camera =
      allowed.camera &&
      p.stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
    const screen = p.screenStream
      .getVideoTracks()
      .some((t) => t.readyState === "live" && !t.muted);

    /*
     * And silence it for real. `hasAudio: false` only stops the UI drawing a
     * speaking ring; the track is still attached to an element somewhere and
     * still audible. Disabling it is local, reversible on the next tick, and
     * the only thing that actually stops the sound.
     */
    for (const t of p.stream.getAudioTracks()) t.enabled = allowed.mic;
    for (const t of p.stream.getVideoTracks()) t.enabled = allowed.camera;

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
    if (this.transport === "sfu") {
      /*
       * Published once, not once per person. This is the entire point of the
       * SFU: in a mesh this loop is where a phone ends up encoding a separate
       * stream for every other person in the room.
       */
      this.sfu ??= this.buildSfu();
      void this.sfu
        .setLocal({
          mic: this.state.micOn ? (this.micStream?.getAudioTracks()[0] ?? null) : null,
          camera: this.state.cameraOn ? (this.camStream?.getVideoTracks()[0] ?? null) : null,
          screen: this.state.sharing ? (this.screenStream?.getVideoTracks()[0] ?? null) : null,
        })
        .catch((e) => console.error("[sfu] publish failed", e));
      return;
    }
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
    /*
     * A room can be set so that only the platform may be heard. Refused here
     * as well as on the server, and with a reason rather than silently: the
     * button is already dead in the interface, so arriving at this line means
     * a keyboard shortcut or a stale page, and either deserves the sentence.
     */
    if (on && !this.state.rights.mic) {
      this.events.onError?.(
        "Only the host can turn a microphone on in this meeting.",
      );
      return;
    }

    if (on && !this.micStream) {
      this.micStream = await this.openMic();
      if (!this.micStream) return;
    }
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.state.micOn = on;
    this.attachEverywhere();
    this.pushState();
  }

  /**
   * Open the microphone, and watch it for the rest of the call.
   *
   * The constraints are the usual three. The watching is the part that was
   * missing: a local audio track ends on its own far more often than anybody
   * expects — a headset unplugged, Bluetooth handing over, Android giving the
   * microphone to an incoming call, a browser reclaiming a backgrounded tab's
   * devices — and when it does, absolutely nothing happens. No error, no
   * event out of this module, no change on screen. The sender goes on holding
   * a dead track, every peer goes on showing the person as unmuted, and they
   * go on talking to a room that cannot hear them until somebody thinks to
   * say so.
   *
   * That is a large part of "audio cuts out and never comes back", and it is
   * not a network problem at all, which is why no amount of bandwidth work
   * would have found it.
   */
  private async openMic(): Promise<MediaStream | null> {
    const stream = await this.capture(
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          /*
           * One channel, asked for explicitly. A stereo microphone doubles
           * what the encoder is handed for no benefit to a voice, and some
           * browsers will capture two channels and then negotiate Opus mono,
           * which is work done twice to throw half of it away.
           */
          channelCount: 1,
        },
      },
      { audio: true },
      "microphone",
    );
    const track = stream?.getAudioTracks()[0];
    if (track) {
      track.addEventListener("ended", () => void this.recoverMic("the track ended"));
      /*
       * `muted` is never written into `micOn` — that is what the PERSON chose,
       * and inferring it from the device is how somebody ends up silenced by a
       * Bluetooth hiccup. But it must not be ignored either, which is what it
       * used to be: a capture track that goes muted and STAYS muted is a
       * microphone the operating system has taken away, and the person goes on
       * talking with a live-looking button. The device recovers in a second
       * when it is handing over; anything longer is a fault.
       */
      track.addEventListener("mute", () => {
        console.warn("[meeting] the microphone went quiet at the device level");
        if (this.micMuteTimer) clearTimeout(this.micMuteTimer);
        this.micMuteTimer = setTimeout(() => {
          this.micMuteTimer = null;
          const live = this.micStream?.getAudioTracks()[0];
          if (!this.running || !this.state.micOn) return;
          if (!live || !live.muted) return;
          void this.recoverMic("the device stopped giving us any sound");
        }, MIC_MUTE_GRACE_MS);
      });
      track.addEventListener("unmute", () => {
        if (this.micMuteTimer) clearTimeout(this.micMuteTimer);
        this.micMuteTimer = null;
      });
    }
    return stream;
  }

  /**
   * Is the microphone we think we are using still alive?
   *
   * Called on `devicechange`, because on some Android builds that is the only
   * notice given. Cheap enough to run on every one.
   */
  private checkMicAlive(): void {
    if (!this.running || !this.state.micOn) return;
    const track = this.micStream?.getAudioTracks()[0];
    if (!track || track.readyState === "ended") {
      void this.recoverMic("the device list changed");
    }
  }

  /**
   * Re-open a microphone that died, and say so either way.
   *
   * Bounded, because a device that has genuinely gone — a headset carried out
   * of the room — must not be retried for the rest of the hour. The person is
   * told on the first recovery and on the giving up; the quiet middle is the
   * one case where saying nothing is right, because it worked.
   */
  private async recoverMic(why: string): Promise<void> {
    if (!this.running || !this.state.micOn) return;
    if (this.micRecoveries >= MIC_RECOVERY_LIMIT) {
      /*
       * And say so to the ROOM, not only to this person.
       *
       * Giving up used to leave `micOn` true with no working track on any
       * sender, so every other participant went on seeing a live microphone
       * beside a name nobody could hear — and the person themselves had a red
       * "mute" button suggesting they were being heard. Turning it off is the
       * honest state: nothing is being sent, the button says so, the roster
       * says so, and pressing it tries the device again.
       */
      console.error("[meeting] giving up on the microphone after", why);
      this.state.micOn = false;
      this.attachEverywhere();
      this.pushState();
      this.events.onLocalState?.({ ...this.state });
      this.events.onMicInterrupted?.("lost");
      return;
    }
    this.micRecoveries++;
    console.warn("[meeting] re-opening the microphone:", why);

    this.stopStream(this.micStream);
    this.micStream = null;

    const fresh = await this.openMic();
    if (!fresh) {
      this.events.onMicInterrupted?.("lost");
      return;
    }
    this.micStream = fresh;
    fresh.getAudioTracks().forEach((t) => (t.enabled = true));
    /*
     * Six recoveries was a per-CALL allowance, so a two-hour service that
     * handed the microphone over six times in its first ten minutes spent the
     * lot and was defenceless for the remaining hour and fifty. The count is
     * now forgiven once a recovery has held for a while.
     */
    if (this.micForgiveTimer) clearTimeout(this.micForgiveTimer);
    this.micForgiveTimer = setTimeout(() => {
      this.micForgiveTimer = null;
      this.micRecoveries = 0;
    }, MIC_FORGIVE_MS);
    // `replaceTrack` on the senders that already exist, so nobody
    // renegotiates and no picture flickers — the room simply starts hearing
    // this person again.
    this.attachEverywhere();
    this.events.onMicInterrupted?.("recovered");
  }

  async setCamera(on: boolean, facing?: "user" | "environment"): Promise<void> {
    const wanted = facing ?? this.state.facing;

    if (on && !this.state.rights.camera) {
      this.events.onError?.("Only the host can turn a camera on in this meeting.");
      return;
    }

    if (on && this.state.lowData) {
      this.events.onError?.("Turn off low-data mode to use your camera.");
      return;
    }

    if (on && (!this.camStream || facing)) {
      this.stopStream(this.camStream);
      this.camStream = null;
      const p = this.state.profile;

      /*
       * Ask for the shape the device is actually held in.
       *
       * The profile is written landscape, because that is how a laptop sees
       * the world. Asking a phone held upright for 640x360 gets a landscape
       * frame: the person ends up as a small figure in a wide strip, and the
       * tile — which is tall on a phone — crops most of it away. Swapping the
       * two asks for 360x640 and fills the tile with a face.
       *
       * Pixel count is unchanged, so this costs no extra bandwidth; it is the
       * same budget spent on the part of the scene somebody is in.
       */
      const upright = isPortrait();
      const width = upright ? p.maxHeight : p.maxWidth;
      const height = upright ? p.maxWidth : p.maxHeight;

      this.camStream = await this.capture(
        {
          video: {
            facingMode: wanted,
            width: { ideal: width, max: 1280 },
            height: { ideal: height, max: 1280 },
            frameRate: { ideal: p.frameRate, max: 30 },
          },
        },
        { video: { facingMode: wanted } },
        "camera",
      );
      this.capturedPortrait = upright;
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

  /**
   * The device was rotated. Re-take the camera in the new shape.
   *
   * `replaceTrack` on the existing sender, so there is no renegotiation and
   * nobody else in the room notices anything but the picture changing shape.
   * Does nothing when the camera is off, or when the orientation has not
   * actually changed — a keyboard opening is not a rotation.
   */
  async handleRotation(): Promise<void> {
    if (!this.state.cameraOn) return;
    if (isPortrait() === this.capturedPortrait) return;
    await this.setCamera(true, this.state.facing);
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

    if (!canShareScreen()) {
      // Not supported, which is a different thing from refused or cancelled,
      // and the only one of the three the person can do anything about.
      this.events.onShareUnsupported?.();
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

  /**
   * Say whose pictures are on screen.
   *
   * Only meaningful on the SFU, where it is the difference between a download
   * that grows with the room and one that does not — every camera in a
   * two-hundred-person room is sixty megabits, and nine of them is four. On a
   * mesh it is ignored: a mesh peer is already sending or not sending, and
   * there is nothing in between to ask for.
   */
  setVideoInterest(peerIds: Iterable<string>): void {
    this.sfu?.setVideoInterest(peerIds);
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
    // On the SFU the room size no longer decides the upload, because there is
    // only ever one of it. The link's own quality still does.
    const peers = this.transport === "sfu" ? 1 : Math.max(1, this.peers.size);
    this.state.profile = profileFor({
      peers,
      lowData: this.state.lowData,
      link: this.state.quality,
      screen: this.state.sharing,
    });
    for (const [, p] of this.peers) this.applyProfileTo(p);
    /*
     * The SFU holds its own senders and receivers, so the jitter buffer and
     * the voice's priority have to be re-applied there too. Without this a
     * room that was rated "poor" halfway through kept the 200ms buffer it
     * negotiated with — which is the one case the whole measurement exists
     * for.
     */
    this.sfu?.tuneAudio();
    this.reshapeAudioIfNeeded();
    this.events.onLocalState?.({ ...this.state });
  }

  /**
   * Put the voice's new shape on a connection that is already running — by
   * building a new connection, not by renegotiating the old one.
   *
   * Redundancy is the one dial that is not a runtime setting: RED is chosen in
   * the SDP, there is no switch for it anywhere in WebRTC, so changing our
   * mind about it means a new description. This used to be a new offer, and
   * that is the bug the whole of this module has just been rewritten around.
   *
   * What happened. Both ends of a pair decide to change shape *for the same
   * reason at the same moment*, because they are both measuring the same bad
   * link — so a collision was the normal case rather than the unlucky one.
   * Perfect negotiation resolves a collision by rolling an offer back, and a
   * rollback leaves transceivers behind. After a few, the two sides no longer
   * agree on the order of their m-lines, and from that point every description
   * either one builds is refused by the other:
   *
   *     The order of m-lines in answer doesn't match order in offer
   *
   * The connection then sits in `have-local-offer` for the rest of the call
   * with one direction of its audio gone. Nothing throws where a person can
   * see it, the tiles stay lit, the roster is right, and somebody talks to a
   * room that cannot hear them. That is what "only one person could be heard"
   * was.
   *
   * Nominating one offerer per pair made it much rarer and did not make it go
   * away — measured in `scripts/test-meeting-call.mjs`, which runs three real
   * browsers through a real meeting: three runs in five came back clean
   * instead of five in five. Two in five is not a fix.
   *
   * So the connection is thrown away and dialled again instead. A fresh
   * connection negotiates the current shape from nothing: no rollback, no
   * second offer, no m-line ordering to reason about — which is the invariant
   * `createPeer` is built on and the one that mid-call renegotiation quietly
   * broke. It costs that pair about a second of media, which on a link bad
   * enough to want redundancy is a trade worth making, and it reuses the same
   * path that recovers a wedged connection, so there is one mechanism here
   * rather than two.
   *
   * Hedged accordingly: the initiator only, so a pair cannot both start it;
   * not within a minute of the last one on that connection, so a link flapping
   * between "fair" and "good" cannot rebuild every half minute; and capped for
   * the call, so the worst case is a connection that keeps the shape it has.
   *
   * Mesh only. The SFU path re-reads the profile when it publishes, and those
   * rooms keep the tuning, the priority and the jitter buffer, which is most
   * of the benefit.
   */
  private reshapeAudioIfNeeded(): void {
    if (this.transport !== "mesh") return;
    const shape = audioShapeKey(this.state.profile.audio);

    const now = Date.now();
    for (const [peerId, p] of this.peers) {
      if (p.audioShape === shape) continue;
      // Mid-negotiation is not the moment: the connection is about to agree
      // something, and it may well be this.
      if (p.pc.signalingState !== "stable" || p.makingOffer) continue;
      if (now - p.audioOfferedAt < AUDIO_RESHAPE_MS) continue;

      /*
       * One side starts it, and the other is told by `rebuildPeer`. Both must
       * forget the connection: a fresh offer meeting the old one is a
       * renegotiation again, which is the thing being avoided.
       */
      if (p.polite) continue;

      p.audioOfferedAt = now;
      console.info(
        `[meeting] the voice on this link now wants "${shape}" rather than ` +
          `"${p.audioShape}".`,
      );
      this.rebuildPeer(peerId, p, "voice");
    }
  }

  /**
   * Throw a peer connection away so the next roster poll builds a fresh one.
   *
   * `reconcilePeers` dials anybody in the roster it has no connection to, and
   * decides the initiator deterministically — so forgetting a peer here is the
   * whole of the recovery, on both sides, with no new state machine.
   */
  private dropPeer(peerId: string, p: PeerState): void {
    /*
     * Only if the map still holds THIS connection.
     *
     * A rebuild replaces the entry, and anything still holding the old
     * `PeerState` — a queued negotiation step, a timer armed before the
     * swap — would otherwise delete the healthy replacement and wipe that
     * person's media with it.
     */
    if (this.peers.get(peerId) !== p) return;
    try {
      p.pc.close();
    } catch {
      /* already closed */
    }
    // Everything already written about this connection is now stale.
    this.droppedAt.set(peerId, this.cursor);
    this.peers.delete(peerId);
    this.media.delete(peerId);
    this.events.onMedia?.(new Map(this.media));
  }

  /**
   * Rebuild any connection that has stopped negotiating, and say that it did.
   *
   * There is no description that recovers a pair whose m-lines have fallen out
   * of step — that is why this is a rebuild and not a retry. Both ends have to
   * forget the connection or the fresh offer meets the old, disordered one
   * again, so the peer is told to drop its side too.
   *
   * Capped per peer: a connection that cannot be negotiated three times
   * running has something else wrong with it, and rebuilding for ever would
   * turn a bad link into a permanent reconnect loop.
   */
  private recoverWedgedPeers(): void {
    if (this.transport !== "mesh") return;
    const now = Date.now();

    for (const [peerId, p] of this.peers) {
      if (p.pc.signalingState === "stable") continue;
      if (p.unstableSince === null) {
        p.unstableSince = now;
        continue;
      }
      if (now - p.unstableSince < NEGOTIATION_WEDGE_MS) continue;

      console.warn(
        `[meeting] negotiation with ${peerId} has been stuck in ` +
          `"${p.pc.signalingState}" for ` +
          `${Math.round((now - p.unstableSince) / 1000)}s.`,
      );
      this.rebuildPeer(peerId, p, "stuck");
    }
  }

  /**
   * Throw this connection away, tell the peer to do the same, and dial again.
   *
   * The one way out of a connection that cannot be negotiated, and — since
   * mid-call renegotiation turned out to be what broke this module — also the
   * way a change of voice shape is applied. Both sides must forget it: a fresh
   * offer meeting the old connection is a renegotiation, which is the thing
   * being avoided. `reconcilePeers` dials again from the next roster poll.
   *
   * Capped per peer for the length of the call. A connection that cannot be
   * built three times running has something else wrong with it, and rebuilding
   * for ever would turn a bad link into a permanent reconnect loop — which is
   * worse than a link that stays as it is, because at least that one is
   * carrying something.
   */
  private rebuildPeer(
    peerId: string,
    p: PeerState,
    reason: "stuck" | "refused" | "voice" | "ice",
  ): boolean {
    /*
     * Two budgets, not one.
     *
     * A voice reshape is a comfort and a recovery is the call working at all,
     * and they used to share three rebuilds between them — so three ordinary
     * quality wobbles in the first minutes spent the whole allowance, and a
     * connection that genuinely wedged later could never be repaired. The
     * cosmetic reason now gets its own small budget and cannot touch the
     * other.
     */
    const budget = reason === "voice" ? this.voiceResets : this.recoveryResets;
    const limit = reason === "voice" ? VOICE_RESHAPE_LIMIT : PEER_RESET_LIMIT;
    const used = budget.get(peerId) ?? 0;
    if (used >= limit) {
      if (reason !== "voice") {
        console.error(
          `[meeting] the connection to ${peerId} has been rebuilt ${limit} ` +
            `times and is still not working. Leaving it alone; this call may ` +
            `be one-sided with that person.`,
        );
      }
      return false;
    }
    budget.set(peerId, used + 1);
    console.warn(
      `[meeting] rebuilding the connection to ${peerId} (${reason}, ` +
        `${used + 1} of ${limit}).`,
    );
    this.send("renegotiate", {}, peerId);
    this.dropPeer(peerId, p);
    // A rebuild for the voice's sake is the engine doing its job; the other
    // two mean somebody could not be heard, and that is worth a sentence.
    this.events.onPeerRebuilt?.(peerId, reason === "voice" ? "voice" : "stuck");
    return true;
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
      opts: {
        maxFramerate?: number;
        degradation?: RTCDegradationPreference;
        priority?: RTCPriorityType;
      } = {},
    ) => {
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = maxBitrate;
        if (opts.maxFramerate) params.encodings[0].maxFramerate = opts.maxFramerate;
        if (opts.priority) {
          /*
           * Who gives way when the uplink cannot carry everything.
           *
           * This is the setting that stops a camera from taking the voice down
           * with it. Without it a browser divides what it has between audio
           * and video by its own rules, and on a phone pushing 300kbps of
           * video up a 200kbps link that means the speech queues behind the
           * frames — which is heard as the voice breaking up every time
           * somebody switches a camera on. `priority` is the bandwidth
           * allocator's ranking; `networkPriority` is the DSCP marking, which
           * some mobile networks actually honour.
           */
          params.encodings[0].priority = opts.priority;
          params.encodings[0].networkPriority = opts.priority;
        }
        if (opts.degradation) params.degradationPreference = opts.degradation;
        void sender.setParameters(params).catch((e) => {
          // Not fatal — the browser carries on with its own numbers, greedier
          // than we asked for. Worth seeing, because "we set a ceiling and it
          // was ignored" and "we never set one" look identical in getStats.
          console.warn("[meeting] sender parameters refused", e);
        });
      } catch (e) {
        console.warn("[meeting] sender parameters could not be read", e);
      }
    };

    /*
     * The ceiling is the WIRE cost, headers and redundancy included — not the
     * Opus target. Setting it to the target alone would have the allocator
     * squeeze the second RED copy back out again, so we would pay for
     * redundancy in SDP and never receive any of it.
     */
    set(p.slots.audio?.sender, audioWireBitrate(prof.audio), { priority: "high" });
    set(p.slots.camera?.sender, prof.videoBitrate || 1, {
      maxFramerate: prof.frameRate || undefined,
      degradation: "maintain-framerate",
      priority: "low",
    });
    // A shared screen is usually words on a slide: keep them sharp and let
    // the frame rate fall instead.
    set(p.slots.screen?.sender, 800_000, {
      maxFramerate: 8,
      degradation: "maintain-resolution",
      priority: "low",
    });

    this.tuneAudioReceiver(p.slots.audio?.receiver, prof.audio);
  }

  /**
   * Hold some audio back before playing it.
   *
   * The single most effective thing in this file for "the sound keeps cutting
   * in and out", and it costs no bandwidth at all. A player with an empty
   * buffer has to invent any gap, and packets on a mobile link do not arrive
   * one at a time — they stop for 300ms and then arrive in a gust. Chrome's
   * own adaptive buffer starts small and grows only after it has already
   * produced audible damage; this asks for the room up front, sized to what
   * the link has been measured doing.
   *
   * `jitterBufferTarget` is the standard property; `playoutDelayHint` is the
   * older Chrome one and is set too, because a browser that has the second and
   * not the first is exactly the kind of browser a church member is using.
   * Neither existing is not a failure — it is recorded once and the call goes
   * on with the browser's own behaviour.
   */
  private tuneAudioReceiver(
    receiver: RTCRtpReceiver | undefined,
    audio: AudioProfile,
  ): void {
    if (!receiver) return;
    const r = receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number | null;
      playoutDelayHint?: number | null;
    };
    let applied = false;
    try {
      if ("jitterBufferTarget" in r) {
        r.jitterBufferTarget = audio.jitterBufferMs;
        applied = true;
      }
      if ("playoutDelayHint" in r) {
        r.playoutDelayHint = audio.jitterBufferMs / 1000;
        applied = true;
      }
    } catch (e) {
      if (!this.jitterBufferRefused) {
        this.jitterBufferRefused = true;
        console.warn("[meeting] this browser refused a jitter buffer hint", e);
      }
      return;
    }
    if (!applied && !this.jitterBufferRefused) {
      this.jitterBufferRefused = true;
      console.warn(
        "[meeting] this browser has no jitter buffer control; audio gaps will be its own to manage",
      );
    }
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
    sample: {
      bytes: { videoOut: number; audioOut: number; videoIn: number; audioIn: number };
      transport: string | null;
      framesDecoded: number;
      framesDropped: number;
      audio: {
        packetsReceived: number;
        packetsLost: number;
        concealedSamples: number;
        totalSamples: number;
        jitterMs: number;
        jitterBufferMs: number;
      };
    },
  ): PeerDiagnostics {
    const now = Date.now();
    const prev = p.lastBytes;
    const seconds = prev ? (now - prev.at) / 1000 : 0;
    const kbps = (curr: number, before: number) =>
      seconds > 0 ? Math.max(0, Math.round(((curr - before) * 8) / seconds / 1000)) : 0;
    const bytes = sample.bytes;

    /*
     * Loss and concealment since the LAST sample, as a share of what arrived
     * in that window. Cumulative counters would average a rough first minute
     * over a smooth hour, which is the opposite of what anybody looking at
     * this panel wants to know.
     */
    const before = p.lastAudio;
    const share = (curr: number, was: number, overCurr: number, overWas: number) => {
      const top = Math.max(0, curr - was);
      const bottom = Math.max(0, overCurr - overWas);
      return bottom > 0 ? Math.round((top / bottom) * 1000) / 10 : 0;
    };
    const a = sample.audio;
    const audioLossPct = before
      ? share(
          a.packetsLost,
          before.packetsLost,
          a.packetsLost + a.packetsReceived,
          before.packetsLost + before.packetsReceived,
        )
      : 0;
    const audioConcealedPct = before
      ? share(a.concealedSamples, before.concealedSamples, a.totalSamples, before.totalSamples)
      : 0;

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
      transport: sample.transport,
      framesDecoded: sample.framesDecoded,
      framesDropped: sample.framesDropped,
      audioLossPct,
      audioConcealedPct,
      audioJitterMs: Math.round(a.jitterMs),
      audioJitterBufferMs: Math.round(a.jitterBufferMs),
      audioRedundancy: this.state.profile.audio.redundancy,
    };

    p.lastBytes = { at: now, ...bytes };
    p.lastAudio = {
      packetsReceived: a.packetsReceived,
      packetsLost: a.packetsLost,
      concealedSamples: a.concealedSamples,
      totalSamples: a.totalSamples,
    };
    p.lastConcealedPct = audioConcealedPct;
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

  /**
   * Refreshed on the same tick the mesh path samples on, so the panel behaves
   * identically whichever transport a room is using. A diagnostic that works
   * on one and not the other is how a blind spot gets built.
   */
  private sfuDiagnostics: PeerDiagnostics[] = [];

  private async sampleSfu(): Promise<void> {
    if (!this.sfu) return;
    this.totals = await this.sfu.totals();
    const rows = await this.sfu.diagnose();
    this.rateSfuLink(rows);
    const out = await this.sfu.outgoingAudio();
    const audioOutKbps = this.watchOutgoingVoice(out);
    this.sfuDiagnostics = [...rows.entries()].map(([peerId, d]) => ({
      peerId,
      ice: d.ice,
      videoAttached: this.state.cameraOn,
      videoWithheld: this.state.cameraOn ? null : ("camera-off" as const),
      videoOutKbps: 0,
      // Measured, not assumed. This was a hardcoded zero, so the one panel
      // that could have said "your voice is not leaving this machine" said
      // nothing at all on the transport every real meeting uses.
      audioOutKbps,
      videoInKbps: d.videoInKbps,
      audioInKbps: d.audioInKbps,
      transport: "sfu",
      framesDecoded: d.framesDecoded,
      framesDropped: 0,
      audioLossPct: d.audioLossPct,
      audioConcealedPct: d.audioConcealedPct,
      audioJitterMs: d.audioJitterMs,
      audioJitterBufferMs: d.audioJitterBufferMs,
      // The SFU path keeps the tuning and the jitter buffer but not RED — see
      // `reshapeAudioIfNeeded`.
      audioRedundancy: false,
    }));
  }

  /**
   * Is this person's voice actually leaving the machine?
   *
   * Returns the outgoing rate for the panel, and — the reason this exists —
   * says so when the answer is no.
   *
   * A microphone can be open, unmuted, enabled, producing sound, and still not
   * reaching the room: something else on the page takes the capture device,
   * the sender is left holding a track nothing reads, and the person goes on
   * talking. That happened to a host the moment they started recording, and
   * stayed that way through leaving and rejoining. Nothing threw, nothing was
   * logged, and the diagnostics panel reported their outgoing audio as zero
   * whether it was working or not, so there was nothing to read either.
   *
   * The test is the PAIR of readings. Energy rising means the device is
   * hearing something; packets not moving means none of it is going anywhere.
   * Either one alone proves nothing: DTX makes a quiet room send almost
   * nothing, and a muted microphone is supposed to send nothing at all.
   *
   * Three samples — about twelve seconds — before saying anything, because one
   * stats tick that lands badly is not a fault.
   */
  private watchOutgoingVoice(
    out: {
      bytesSent: number;
      packetsSent: number;
      audioEnergy: number;
      audioLevel: number;
    } | null,
  ): number {
    if (!out) return 0;

    const prev = this.lastOutgoingVoice;
    const now = Date.now();
    this.lastOutgoingVoice = { at: now, ...out };

    const seconds = prev ? (now - prev.at) / 1000 : 0;
    const kbps =
      seconds > 0
        ? Math.max(0, Math.round(((out.bytesSent - prev!.bytesSent) * 8) / seconds / 1000))
        : 0;
    if (!prev) return kbps;

    const track = this.micStream?.getAudioTracks()[0];
    const shouldBeHeard =
      this.state.micOn && !!track && track.readyState === "live" && track.enabled;
    if (!shouldBeHeard) {
      this.voiceSilentStrikes = 0;
      this.voiceSilenceReported = false;
      return kbps;
    }

    // A rise in cumulative energy is the device telling us it heard something.
    // The threshold is small on purpose: this is "any sound at all", not
    // "somebody is speaking clearly".
    const heardSomething = out.audioEnergy - prev.audioEnergy > 1e-7;
    const sentSomething = out.packetsSent > prev.packetsSent;

    if (heardSomething && !sentSomething) {
      this.voiceSilentStrikes++;
      if (this.voiceSilentStrikes >= 3 && !this.voiceSilenceReported) {
        this.voiceSilenceReported = true;
        console.error(
          "[meeting] the microphone is producing sound and none of it is " +
            "being sent. Something else on this page has taken the capture " +
            "device.",
        );
        this.events.onMicInterrupted?.("unheard");
      }
      return kbps;
    }

    if (sentSomething) {
      this.voiceSilentStrikes = 0;
      this.voiceSilenceReported = false;
    }
    return kbps;
  }

  /**
   * Rate an SFU room's link, which nothing used to do at all.
   *
   * On a mesh the verdict comes from what we SEND — loss reported back by each
   * peer, round-trip time, the browser's own estimate of headroom. None of
   * that exists in a useful form here: there is one connection to a media
   * server, and the thing that goes wrong is the voices arriving badly.
   *
   * So the verdict is built from what arrives. Concealment is the reading that
   * matters, because a room of two hundred is exactly where somebody is on a
   * phone in a compound with one bar, and it is what raises their jitter
   * buffer and their redundancy. Without this an SFU room sat on "good" for
   * the whole meeting however it actually sounded.
   */
  private rateSfuLink(rows: Map<string, { audioConcealedPct: number }>): void {
    let worstConcealed = 0;
    for (const [, row] of rows) {
      if (row.audioConcealedPct > worstConcealed) worstConcealed = row.audioConcealedPct;
    }

    this.settleQuality(
      rateLink({
        packetLossPct: 0,
        rttMs: 0,
        audioConcealedPct: worstConcealed,
      }),
    );
  }

  /**
   * Change the verdict only once the link has actually changed its mind.
   *
   * The decision itself is `settleVerdict` in meetings-shared.ts, where it can
   * be tested without a meeting. Everything that follows from it — the voice
   * profile, the jitter buffer, the figure the room shows — happens here.
   */
  private settleQuality(reading: MeetingQuality): void {
    const { apply, candidate } = settleVerdict({
      current: this.state.quality,
      reading,
      candidate: this.qualityCandidate,
    });
    this.qualityCandidate = candidate;
    if (!apply) return;

    this.state.quality = reading;
    this.applyProfile();
    void this.flush({ quality: reading });
  }

  /** Everything the diagnostics panel shows, as of the last sample. */
  diagnostics(): PeerDiagnostics[] {
    if (this.transport === "sfu") return this.sfuDiagnostics;

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
          audioLossPct: 0,
          audioJitterMs: 0,
          audioConcealedPct: 0,
          audioJitterBufferMs: 0,
          audioRedundancy: this.state.profile.audio.redundancy,
        },
    );
  }

  private async sampleStats(): Promise<void> {
    if (this.transport === "sfu") {
      await this.sampleSfu().catch(() => {
        /* a closing connection has no stats to give */
      });
      return;
    }
    if (this.peers.size === 0) return;

    // Before the readings: a connection that has stopped negotiating has no
    // useful numbers to contribute, and leaving it in place is what turns a
    // moment's glare into a call somebody spends silent.
    this.recoverWedgedPeers();
    if (this.peers.size === 0) return;

    let worstLoss = 0;
    let worstRtt = 0;
    let available = 0;
    let worstConcealed = 0;

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
        const audio = {
          packetsReceived: 0,
          packetsLost: 0,
          concealedSamples: 0,
          totalSamples: 0,
          jitterMs: 0,
          jitterBufferMs: 0,
        };

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
            if (report.kind === "audio") {
              bytes.audioIn += n;
              /*
               * The voice, as the player experienced it.
               *
               * `concealedSamples` is the number this module was missing: how
               * much audio the browser INVENTED because nothing had arrived
               * in time to play. A person saying "the sound keeps cutting" is
               * describing this figure and nothing else, and it separates the
               * three causes — loss, jitter, and a dead microphone at the
               * other end — which from a seat in the meeting are identical.
               */
              audio.packetsReceived += Number(report.packetsReceived ?? 0);
              audio.packetsLost += Number(report.packetsLost ?? 0);
              /*
               * Silence subtracted, and this is not a detail.
               *
               * DTX means a listener sends nothing at all while nobody is
               * speaking, and the player fills that gap with synthesised
               * silence — which the browser counts as concealment. Counting it
               * would make a perfectly healthy quiet room read as 90% broken
               * and have every phone in it wind its video down to nothing.
               * `silentConcealedSamples` is the subset that was supposed to be
               * silence; what is left is audio that was supposed to be sound
               * and was not there.
               */
              audio.concealedSamples +=
                Number(report.concealedSamples ?? 0) -
                Number(report.silentConcealedSamples ?? 0);
              audio.totalSamples += Number(report.totalSamplesReceived ?? 0);
              audio.jitterMs = Math.max(
                audio.jitterMs,
                Number(report.jitter ?? 0) * 1000,
              );
              /*
               * jitterBufferDelay is seconds-accumulated and
               * jitterBufferEmittedCount is samples-emitted, so the ratio is
               * the average wait per sample. Reported in ms, where it can be
               * read against the target the profile asked for.
               */
              const delay = Number(report.jitterBufferDelay ?? 0);
              const emitted = Number(report.jitterBufferEmittedCount ?? 0);
              if (emitted > 0) {
                audio.jitterBufferMs = Math.max(
                  audio.jitterBufferMs,
                  (delay / emitted) * 1000,
                );
              }
            }
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

        p.diagnostics = this.rateFlow(p, {
          bytes,
          transport,
          framesDecoded,
          framesDropped,
          audio,
        });
        if (p.lastConcealedPct > worstConcealed) worstConcealed = p.lastConcealedPct;

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

    // Totals for the bill, gathered while we are already here.
    this.totals = { received: 0, sent: 0 };
    for (const [, p] of this.peers) {
      const d = p.diagnostics;
      if (!d) continue;
      const b = p.lastBytes;
      if (!b) continue;
      this.totals.received += b.videoIn + b.audioIn;
      this.totals.sent += b.videoOut + b.audioOut;
    }

    /*
     * Publish what the connection can spare, for the background recording
     * uploader.
     *
     * On the document element rather than through React, deliberately: the
     * uploader sits above the meeting in the tree and runs on every page, and
     * re-rendering the whole app every few seconds to tell it a bitrate would
     * cost more than the upload it is pacing. These are already measured here
     * for the quality indicator; this only writes them down where something
     * else can read them. See lib/upload-budget.ts for what is done with them.
     */
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (available > 0) root.dataset.meetingOutgoingBitrate = String(available);
      else delete root.dataset.meetingOutgoingBitrate;
      root.dataset.meetingLoss = String(worstLoss / 100);
    }

    const quality = rateLink({
      packetLossPct: worstLoss,
      rttMs: worstRtt,
      availableOutgoing: available,
      audioConcealedPct: worstConcealed,
    });

    // Through the same gate as the SFU path: see `settleQuality`.
    this.settleQuality(quality);
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
