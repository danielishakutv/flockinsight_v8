/**
 * Meeting logic with no server dependencies — safe to import from a client
 * component, a server component or a test. The server-only half (queries,
 * writes, scripture fetching) lives in lib/meetings.ts.
 */

/* ============================================================
 * Kinds, roles and status
 * ========================================================== */

export const MEETING_KINDS = [
  "meeting",
  "service",
  "prayer",
  "bible-study",
  "class",
  "counselling",
  "board",
] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_KIND_LABEL: Record<MeetingKind, string> = {
  meeting: "Meeting",
  service: "Service",
  prayer: "Prayer",
  "bible-study": "Bible study",
  class: "Class",
  counselling: "Counselling",
  board: "Board / leadership",
};

export type MeetingStatus = "scheduled" | "live" | "ended" | "cancelled";
export type MeetingAccess = "open" | "passcode" | "members";
export type MeetingRole = "host" | "cohost" | "speaker" | "attendee";
export type MeetingQuality = "good" | "fair" | "poor" | "lost";

export const MEETING_ACCESS_LABEL: Record<MeetingAccess, string> = {
  open: "Anyone with the link",
  passcode: "Link + passcode",
  members: "Signed-in church members only",
};

/** Hosts and co-hosts run the room; everyone else is a guest in it. */
export function isHostRole(role: MeetingRole | string | null | undefined) {
  return role === "host" || role === "cohost";
}

/**
 * Who is "on the platform" — allowed to be heard and seen in a room that has
 * been locked down to its leaders.
 *
 * Wider than `isHostRole` by exactly one role, and the difference is the point.
 * A host running a Sunday service needs to hand the microphone to one person
 * who gave a testimony without also handing them the power to end the meeting
 * or remove somebody. That is what `speaker` is for, and it is why the People
 * panel offers it.
 */
export function isOnPlatform(role: MeetingRole | string | null | undefined) {
  return isHostRole(role) || role === "speaker";
}

/**
 * What this room lets this person turn on.
 *
 * A meeting can be set so that only the platform may speak, or only the
 * platform may be seen, or both. For everybody else those controls are not
 * merely ignored — they are dead, exactly as the camera button is in Data
 * Saver, because a control that looks live and does nothing is worse than one
 * that plainly cannot be used.
 *
 * Here rather than in either half, because the server has to enforce it and
 * the browser has to render it, and the two agreeing matters more than either
 * of them being clever. The room's own flags are the only input besides the
 * role: there is no notion of "a kind of meeting that is always locked", so
 * that a church can run a service where everyone may speak and a board meeting
 * where nobody but the chair may.
 */
export function mediaRights(
  role: MeetingRole | string | null | undefined,
  room: { allowAttendeeMic: boolean; allowAttendeeCamera: boolean },
): { mic: boolean; camera: boolean } {
  const platform = isOnPlatform(role);
  return {
    mic: room.allowAttendeeMic || platform,
    camera: room.allowAttendeeCamera || platform,
  };
}

/* ============================================================
 * Join codes
 *
 * A code gets read out loud — from a pulpit, over a phone, into a WhatsApp
 * message typed by someone in a hurry. So the alphabet drops every character
 * that sounds or looks like another one: no vowels (nothing spells a word by
 * accident), no 0/O, no 1/I/L, no 5/S, no 2/Z.
 * ========================================================== */

const CODE_ALPHABET = "bcdfghjkmnpqrtvwxy34679";

export function generateMeetingCode(
  random: () => number = Math.random,
): string {
  const pick = (n: number) =>
    Array.from(
      { length: n },
      () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)],
    ).join("");
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

/** Accepts what a person actually types: spaces, caps, missing dashes. */
export function normaliseMeetingCode(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  if (cleaned.length !== 10) return cleaned;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
}

/** A 6-digit room passcode. Not a credential — see the schema comment. */
export function generatePasscode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 900000) + 100000);
}

/* ============================================================
 * The shared stage — what everyone is looking at
 * ========================================================== */

export type StageVerse = {
  kind: "verse";
  reference: string;
  translation: string;
  body: string;
  /** Bumped on every change so clients can ignore stale updates. */
  rev: number;
};

export type StageSlide = {
  kind: "slide";
  /** Media ids, in order. */
  slides: string[];
  urls: string[];
  index: number;
  rev: number;
};

export type StageText = {
  kind: "text";
  title: string | null;
  body: string;
  rev: number;
};

export type StageNone = { kind: "none"; rev: number };

export type Stage = StageNone | StageVerse | StageSlide | StageText;

export const EMPTY_STAGE: StageNone = { kind: "none", rev: 0 };

/**
 * Read a stage back out of jsonb. Anything unrecognised becomes an empty
 * stage rather than throwing — a malformed row must not stop a meeting.
 */
export function parseStage(value: unknown): Stage {
  if (!value || typeof value !== "object") return EMPTY_STAGE;
  const v = value as Record<string, unknown>;
  const rev = typeof v.rev === "number" && v.rev >= 0 ? v.rev : 0;
  const str = (x: unknown, max = 4000) =>
    typeof x === "string" ? x.slice(0, max) : "";

  switch (v.kind) {
    case "verse":
      if (!str(v.body)) return { ...EMPTY_STAGE, rev };
      return {
        kind: "verse",
        reference: str(v.reference, 120),
        translation: str(v.translation, 24) || "web",
        body: str(v.body, 8000),
        rev,
      };
    case "slide": {
      const slides = Array.isArray(v.slides)
        ? v.slides.filter((s): s is string => typeof s === "string").slice(0, 200)
        : [];
      const urls = Array.isArray(v.urls)
        ? v.urls.filter((s): s is string => typeof s === "string").slice(0, 200)
        : [];
      if (urls.length === 0) return { ...EMPTY_STAGE, rev };
      const index =
        typeof v.index === "number" && v.index >= 0 && v.index < urls.length
          ? Math.floor(v.index)
          : 0;
      return { kind: "slide", slides, urls, index, rev };
    }
    case "text":
      if (!str(v.body)) return { ...EMPTY_STAGE, rev };
      return {
        kind: "text",
        title: str(v.title, 160) || null,
        body: str(v.body, 4000),
        rev,
      };
    default:
      return { ...EMPTY_STAGE, rev };
  }
}

/* ============================================================
 * Signalling
 * ========================================================== */

export const SIGNAL_TYPES = [
  "offer",
  "answer",
  "ice",
  "bye", // a peer is leaving now, rather than timing out
  "state", // mic/camera/hand/sharing/quality changed
  "roster", // server-generated: the room membership changed
  "chat",
  "stage", // what's on the shared screen changed
  "reaction",
  "control", // host action: mute, remove, promote, admit, end
  "pause", // "stop sending me video" / "start again"
  "recording", // recording started or stopped
  /*
   * "I have dropped my connection to you; drop yours and dial again."
   *
   * The only way the voice's shape changes mid-call, and the only way out of a
   * negotiation that has got stuck. Both are a new connection rather than a
   * new description on the old one, because two peers renegotiating at the
   * same moment can end up with their m-lines in different orders — after
   * which every description either side builds is refused by the other and
   * that pair's audio is dead for the rest of the call, silently.
   */
  "renegotiate",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export type SignalEnvelope = {
  id: number;
  fromPeer: string;
  toPeer: string | null;
  type: SignalType;
  payload: Record<string, unknown>;
  at: string;
};

export type RosterEntry = {
  id: string;
  peerId: string;
  name: string;
  role: MeetingRole;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  handRaised: boolean;
  lowData: boolean;
  quality: MeetingQuality;
  admitted: boolean;
  /**
   * Where this person publishes on the SFU, when the room uses one.
   *
   * A track is addressed as `(sessionId, trackName)` and the names are fixed,
   * so this single value is everything anybody needs to pull their camera.
   * Null on a mesh room, and null briefly on an SFU room before they have
   * published — a subscriber simply waits for the next poll.
   */
  sfuSessionId: string | null;
  joinedAt: string;
  /** Set for someone signed in — a guest has none. */
  userId: string | null;
};

/**
 * Who calls whom.
 *
 * Both sides of a pair learn about each other at the same moment, so without a
 * rule both would send an offer and glare. The peer whose id sorts lower makes
 * the call; the other waits. Deterministic, needs no coordination, and every
 * peer computes the same answer.
 */
export function shouldInitiate(myPeerId: string, theirPeerId: string): boolean {
  return myPeerId < theirPeerId;
}

/**
 * Perfect negotiation's "polite" flag: exactly one side of a pair must be
 * polite, and it has to be the side that did NOT initiate, or a glare rolls
 * back the wrong offer.
 */
export function isPolite(myPeerId: string, theirPeerId: string): boolean {
  return !shouldInitiate(myPeerId, theirPeerId);
}

/* ============================================================
 * Bandwidth
 *
 * The whole point of the module. In a mesh every camera you switch on is sent
 * once per other participant, so a 6-person room with everyone on camera is
 * five uploads from each phone. On a 3G connection that is the difference
 * between a meeting and a slideshow of frozen faces.
 *
 * These profiles are chosen so the *upload* total stays inside a realistic
 * budget as the room grows, and so audio never competes with video for it.
 * ========================================================== */

export type BandwidthProfile = {
  /** Longest edge of the captured frame. */
  maxWidth: number;
  maxHeight: number;
  frameRate: number;
  /** Per-peer video ceiling, bits per second. */
  videoBitrate: number;
  /**
   * How the voice is carried. Described in full rather than as one bitrate,
   * because what keeps audio alive on a weak link is mostly not the bitrate —
   * see the Audio section below.
   */
  audio: AudioProfile;
  label: string;
};

/**
 * Data Saver, on a link that is coping.
 *
 * Exported as a constant because it is the shape most of this product's
 * meetings actually run in, and because the pre-join screen needs something to
 * describe before any link has been measured. `profileFor` swaps the audio for
 * a protected one the moment the connection says it is struggling.
 */
export const AUDIO_ONLY_PROFILE: BandwidthProfile = {
  maxWidth: 0,
  maxHeight: 0,
  frameRate: 0,
  videoBitrate: 0,
  audio: audioProfileFor({ lowData: true }),
  label: "Audio only",
};

/**
 * Pick a profile for the room as it is right now.
 *
 * `peers` is the number of OTHER people receiving your video, which is what
 * actually multiplies your upload. `link` is the last measured verdict on this
 * connection — a poor link drops a tier regardless of room size.
 */
export function profileFor(opts: {
  peers: number;
  lowData: boolean;
  link?: MeetingQuality;
  screen?: boolean;
}): BandwidthProfile {
  /*
   * Data Saver turns the camera off AND shrinks the voice.
   *
   * It used to do only the first, which is why it saved less than people
   * expected: the microphone went on costing 20-32kbps of fullband stereo-
   * capable Opus whether anybody was listening on a 3G phone or not. A voice
   * does not need that. See `audioProfileFor`.
   */
  if (opts.lowData) {
    return { ...AUDIO_ONLY_PROFILE, audio: audioProfileFor({ lowData: true, link: opts.link }) };
  }

  // A shared screen is text more often than motion: keep it readable and let
  // the frame rate go rather than blurring the words.
  if (opts.screen) {
    const poor = opts.link === "poor" || opts.link === "lost";
    return {
      maxWidth: poor ? 1280 : 1920,
      maxHeight: poor ? 720 : 1080,
      frameRate: poor ? 3 : 8,
      videoBitrate: poor ? 250_000 : 800_000,
      audio: audioProfileFor({ lowData: false, link: opts.link }),
      label: poor ? "Screen (light)" : "Screen",
    };
  }

  const peers = Math.max(1, opts.peers);
  /*
   * One voice shape for every video tier.
   *
   * Audio does not get cheaper because the room is smaller, and it must not
   * get worse because the room is larger: the whole point of dropping video to
   * 320x180 at nine people is so that the nine voices still arrive.
   */
  const audio = audioProfileFor({ lowData: false, link: opts.link });
  let tier: BandwidthProfile;
  if (peers <= 1) {
    tier = {
      maxWidth: 1280,
      maxHeight: 720,
      frameRate: 24,
      videoBitrate: 700_000,
      audio,
      label: "HD",
    };
  } else if (peers <= 3) {
    tier = {
      maxWidth: 640,
      maxHeight: 360,
      frameRate: 20,
      videoBitrate: 300_000,
      audio,
      label: "Standard",
    };
  } else if (peers <= 7) {
    tier = {
      maxWidth: 480,
      maxHeight: 270,
      frameRate: 15,
      videoBitrate: 160_000,
      audio,
      label: "Light",
    };
  } else {
    tier = {
      maxWidth: 320,
      maxHeight: 180,
      frameRate: 12,
      videoBitrate: 90_000,
      audio,
      label: "Very light",
    };
  }

  if (opts.link === "poor" || opts.link === "lost") {
    return {
      maxWidth: Math.min(tier.maxWidth, 320),
      maxHeight: Math.min(tier.maxHeight, 180),
      frameRate: 10,
      videoBitrate: Math.min(tier.videoBitrate, 80_000),
      audio,
      label: "Very light",
    };
  }
  if (opts.link === "fair") {
    return {
      ...tier,
      maxWidth: Math.min(tier.maxWidth, 480),
      maxHeight: Math.min(tier.maxHeight, 270),
      frameRate: Math.min(tier.frameRate, 15),
      videoBitrate: Math.round(tier.videoBitrate * 0.6),
      label: "Light",
    };
  }
  return tier;
}

/**
 * Turn WebRTC stats into the four words a person understands.
 *
 * Loss matters more than latency for how a call *feels*: 200ms of delay is
 * barely noticed in a prayer meeting, 8% loss makes every third word vanish.
 */
export function rateLink(opts: {
  packetLossPct: number;
  rttMs: number;
  /** What the browser thinks it can send, bits per second. 0 = unknown. */
  availableOutgoing?: number;
  /**
   * The share of arriving speech the player had to invent, percent.
   *
   * The only reading here about what this person HEARS, and the reason it was
   * added: every other input is about what they SEND. A phone with a fine
   * uplink and a gusty downlink rated its own connection "good" and sat on a
   * 200ms jitter buffer while the voices broke up in its ear, which is exactly
   * the complaint this is meant to answer. Silence concealed during DTX is
   * excluded by the caller, so this counts only audio that was meant to be
   * sound.
   */
  audioConcealedPct?: number;
}): MeetingQuality {
  const { packetLossPct: loss, rttMs: rtt } = opts;
  const concealed = opts.audioConcealedPct ?? 0;
  if (concealed >= 8 || loss >= 12 || rtt >= 1200) return "poor";
  if (concealed >= 2 || loss >= 4 || rtt >= 500) return "fair";
  if (opts.availableOutgoing && opts.availableOutgoing > 0 && opts.availableOutgoing < 60_000)
    return "poor";
  return "good";
}

/** Worst first is the order that matters: a higher number is a worse link. */
const QUALITY_RANK: Record<MeetingQuality, number> = { good: 0, fair: 1, poor: 2, lost: 3 };

/**
 * Should this reading actually change the verdict yet?
 *
 * `rateLink` has no hysteresis and a low bar — two per cent of concealed
 * speech is "fair", and one gust inside a four-second window clears that. The
 * reading is also the WORST of everybody arriving, so in a room of ten the
 * chance that nobody had a rough window is small.
 *
 * On its own that would only mislabel a connection. What made it audible is
 * what the verdict DOES: the voice profile follows it and the profile carries
 * the jitter buffer, so every flip re-times every receiver at once. Shrinking
 * a live playout buffer has to drop or hurry audio and growing it has to
 * invent some — both are heard. A link flickering between "good" and "fair"
 * was therefore a link that clicked every few seconds, on a connection its
 * owner would describe as good.
 *
 * So an IMPROVEMENT has to be confirmed by a second consecutive sample, and
 * getting worse is acted on at once: being slow to protect a call that has
 * genuinely gone bad is the one mistake worth avoiding here, and the
 * protections cost nothing when they turn out not to be needed.
 */
export function settleVerdict(opts: {
  current: MeetingQuality;
  reading: MeetingQuality;
  /** The reading that is waiting to be confirmed, and how many times seen. */
  candidate: { quality: MeetingQuality; samples: number } | null;
  /** Consecutive agreeing samples an improvement needs. */
  confirmations?: number;
}): {
  apply: boolean;
  candidate: { quality: MeetingQuality; samples: number } | null;
} {
  const { current, reading, candidate } = opts;
  const needed = opts.confirmations ?? 2;

  if (reading === current) return { apply: false, candidate: null };

  if (QUALITY_RANK[reading] > QUALITY_RANK[current]) {
    return { apply: true, candidate: null };
  }

  const samples = candidate?.quality === reading ? candidate.samples + 1 : 1;
  if (samples < needed) return { apply: false, candidate: { quality: reading, samples } };
  return { apply: true, candidate: null };
}

export const QUALITY_LABEL: Record<MeetingQuality, string> = {
  good: "Good connection",
  fair: "Connection is a bit weak",
  poor: "Very weak connection",
  lost: "Reconnecting…",
};

/* ============================================================
 * Audio
 *
 * The half of a meeting that matters. A frozen picture is a nuisance; a voice
 * that cuts in and out ends the meeting — and on the networks this product is
 * actually used on, that is the ordinary day rather than the bad one.
 *
 * So the voice is described in full here and never shares a budget with video.
 * Five dials, and each one answers a different failure:
 *
 *   bitrate, maxBandwidth — what the voice costs at all. Browsers negotiate
 *     Opus at ~32kbps with stereo on the table, which is a music setting
 *     nobody in a prayer meeting asked for. Speech is good at 16kbps and
 *     intelligible well below it.
 *   fec — in-band FEC (Opus LBRR) tucks a cheap, lower-quality copy of the
 *     previous frame inside every packet. One lost packet is then softened
 *     rather than silent, for about a quarter more bits.
 *   redundancy — RED carries the previous packet in FULL beside the current
 *     one. Roughly twice the bits, and a single lost packet becomes inaudible
 *     rather than merely softened. This is the dial that answers "no audio
 *     loss at all", and it is turned on by measurement rather than by hope: a
 *     good link does not need it and should not pay for it.
 *   dtx — send nothing while nobody is speaking. In a meeting where one
 *     person talks and nine listen, this alone is most of the saving.
 *   jitterBufferMs — how much audio to hold back before playing it. THE dial
 *     for "the voice keeps seizing". Packets on a mobile link do not arrive
 *     late one at a time, they arrive in gusts, and a player with nothing in
 *     hand has to invent the gap. Holding 400ms costs 400ms of delay, which
 *     nobody notices in a prayer meeting, and turns a gust into nothing at all.
 *
 * All of it is cheap to be wrong about: the worst outcome of a profile a
 * browser will not accept is that it keeps using its own.
 * ========================================================== */

export type AudioProfile = {
  /** Opus target, bits per second, before any redundancy. */
  bitrate: number;
  /** Widest band the encoder may use, Hz. 0 leaves the choice to the browser. */
  maxBandwidth: number;
  /** Milliseconds of voice per packet. */
  ptime: number;
  /** In-band FEC: a cheap copy of the previous frame inside every packet. */
  fec: boolean;
  /** Stop sending entirely during silence. */
  dtx: boolean;
  /** RED: every packet carries the previous one in full. About twice the bits. */
  redundancy: boolean;
  /** How much audio to hold before playing it, milliseconds. */
  jitterBufferMs: number;
  /** Shown in diagnostics, so what is in force can be read rather than guessed. */
  label: string;
};

/**
 * Pick a voice for this person, on this link, right now.
 *
 * Two inputs and no more. Room size is deliberately absent: a voice costs the
 * same whoever is listening, and the answer to a big room is to stop sending
 * pictures, never to start degrading speech.
 *
 * `ptime` stays at 60ms throughout. A packet carries 40 bytes of IP, UDP and
 * RTP headers whatever is inside it, so at these bitrates the headers are a
 * third of the traffic at 20ms packets and a tenth at 60ms. Shortening packets
 * to make each individual loss smaller is the wrong trade once RED is carrying
 * the lost one anyway.
 */
export function audioProfileFor(opts: {
  lowData: boolean;
  link?: MeetingQuality;
}): AudioProfile {
  const struggling = opts.link === "poor" || opts.link === "lost";
  const weak = struggling || opts.link === "fair";

  /*
   * Data Saver. Narrowed to 16kHz — wideband, better than a phone call, and
   * above every frequency a voice needs — at half the bits a browser would
   * have chosen. On a struggling link it narrows again and spends what it
   * saved on redundancy, so Data Saver on a bad network costs roughly what
   * plain audio used to cost and breaks up far less.
   */
  if (opts.lowData) {
    if (struggling)
      return {
        bitrate: 9000,
        maxBandwidth: 12000,
        ptime: 60,
        fec: true,
        dtx: true,
        redundancy: true,
        jitterBufferMs: 700,
        label: "Voice, protected",
      };
    if (weak)
      return {
        bitrate: 11000,
        maxBandwidth: 16000,
        ptime: 60,
        fec: true,
        dtx: true,
        redundancy: true,
        jitterBufferMs: 450,
        label: "Voice, protected",
      };
    return {
      bitrate: 12000,
      maxBandwidth: 16000,
      ptime: 60,
      fec: true,
      dtx: true,
      redundancy: false,
      jitterBufferMs: 300,
      label: "Voice",
    };
  }

  if (struggling)
    return {
      bitrate: 16000,
      maxBandwidth: 16000,
      ptime: 60,
      fec: true,
      dtx: true,
      redundancy: true,
      jitterBufferMs: 700,
      label: "Speech, protected",
    };
  if (weak)
    return {
      bitrate: 20000,
      maxBandwidth: 16000,
      ptime: 60,
      fec: true,
      dtx: true,
      redundancy: true,
      jitterBufferMs: 400,
      label: "Speech, protected",
    };
  return {
    bitrate: 24000,
    maxBandwidth: 0,
    ptime: 60,
    fec: true,
    dtx: true,
    redundancy: false,
    jitterBufferMs: 200,
    label: "Speech",
  };
}

/** What a meeting negotiates with before any link has been measured. */
export const DEFAULT_AUDIO_PROFILE: AudioProfile = audioProfileFor({ lowData: false });

/**
 * What one voice actually costs on the wire, bits per second.
 *
 * Headers included, because at these bitrates they are not a rounding error,
 * and redundancy included, because that is the whole question when deciding
 * whether a link can afford it. Used to set the sender's ceiling: a ceiling at
 * the Opus target alone would squeeze out the redundancy we just asked for and
 * leave only its cost.
 */
export function audioWireBitrate(a: AudioProfile): number {
  const perSecond = 1000 / a.ptime;
  const payload = (a.bitrate / perSecond) * (a.redundancy ? 2 : 1);
  const headers = 40 * 8; // IP + UDP + RTP, per packet
  return Math.round((payload + headers) * perSecond);
}

/**
 * Two profiles differ in a way that needs a new offer.
 *
 * Bitrate and the jitter buffer are set at runtime and cost nothing to change.
 * Everything in this key lives in the SDP, so changing it means renegotiating —
 * worth it for redundancy, not worth it for a 4kbps difference in target.
 */
export function audioShapeKey(a: AudioProfile): string {
  const flags = `${a.fec ? "fec" : "nofec"}/${a.dtx ? "dtx" : "nodtx"}`;
  return `${a.redundancy ? "red" : "plain"}/${a.maxBandwidth}/${a.ptime}/${flags}`;
}

/**
 * Write a profile into an SDP we are about to set as our own description.
 *
 * Offer and answer alike: the preferences in the description a peer sets
 * locally are what that peer SENDS with, so both halves of a call have to be
 * tuned or only one direction improves.
 */
export function tuneOpus(
  sdp: string,
  audio: AudioProfile = DEFAULT_AUDIO_PROFILE,
): string {
  const payload = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!payload) return sdp;

  const ours = [
    "stereo=0",
    "sprop-stereo=0",
    `useinbandfec=${audio.fec ? 1 : 0}`,
    `usedtx=${audio.dtx ? 1 : 0}`,
    `maxaveragebitrate=${audio.bitrate}`,
    `ptime=${audio.ptime}`,
    `maxptime=${Math.max(audio.ptime, 120)}`,
    /*
     * Capping the capture rate as well as the playback rate is what makes the
     * saving real. `maxplaybackrate` alone only tells the far end what we are
     * able to play; `sprop-maxcapturerate` tells OUR OWN encoder not to spend
     * bits on frequencies that are not in a human voice.
     */
    ...(audio.maxBandwidth > 0
      ? [
          `maxplaybackrate=${audio.maxBandwidth}`,
          `sprop-maxcapturerate=${audio.maxBandwidth}`,
        ]
      : []),
  ].join(";");

  const overridden = [
    "stereo",
    "sprop-stereo",
    "useinbandfec",
    "usedtx",
    "maxaveragebitrate",
    "ptime",
    "maxptime",
    "maxplaybackrate",
    "sprop-maxcapturerate",
  ];

  const fmtp = new RegExp(`a=fmtp:${payload} (.*)`);
  const tuned = fmtp.test(sdp)
    ? sdp.replace(fmtp, (_m, existing: string) => {
        // Keep anything the browser put there that we are not overriding.
        const keep = existing
          .split(";")
          .filter((part) => {
            const key = part.split("=")[0]?.trim();
            return key && !overridden.includes(key);
          })
          .join(";");
        return `a=fmtp:${payload} ${keep ? `${keep};` : ""}${ours}`;
      })
    : sdp.replace(
        new RegExp(`(a=rtpmap:${payload} opus/48000.*\r?\n)`),
        `$1a=fmtp:${payload} ${ours}\r\n`,
      );

  return preferAudioCodec(tuned, audio.redundancy ? "red" : "opus");
}

/**
 * Put one payload type at the head of the m=audio line.
 *
 * This is the only way to turn RED on or off. There is no runtime switch for
 * it anywhere in WebRTC: a browser sends with whichever audio codec its own
 * description names first, and `red` is a wrapper carrying the previous packet
 * beside the current one. Moving it to the front is how you ask for it, and
 * moving Opus back to the front is the only way to stop.
 *
 * Both directions are written explicitly rather than leaving the list alone
 * when redundancy is off, so the result is deterministic: whatever the browser
 * generated, the description that goes out says what we decided.
 *
 * Returns the SDP untouched when that codec is not in the list at all — every
 * browser except Chrome and Edge, and anything behind an SFU that will not
 * relay it. Those keep the Opus tuning and the jitter buffer and simply do not
 * get RED, which is a floor rather than a failure.
 */
function preferAudioCodec(sdp: string, codec: "red" | "opus"): string {
  const pattern =
    codec === "red" ? /a=rtpmap:(\d+) red\/48000/i : /a=rtpmap:(\d+) opus\/48000/i;
  const pt = sdp.match(pattern)?.[1];
  if (!pt) return sdp;

  return sdp.replace(/^m=audio ([^\r\n]+)/im, (line, rest: string) => {
    const parts = rest.split(" ");
    // "<port> <proto>", then the payload list in preference order.
    const head = parts.slice(0, 2);
    const payloads = parts.slice(2);
    if (!payloads.includes(pt)) return line;
    return `m=audio ${[...head, pt, ...payloads.filter((x) => x !== pt)].join(" ")}`;
  });
}

/* ============================================================
 * Small helpers the UI needs in several places
 * ========================================================== */

export function meetingLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/meet/${code}`;
}

/**
 * The link that also says "I am running this".
 *
 * Deliberately a different URL from the one everybody else gets, so the two
 * can never be confused in a WhatsApp message.
 */
export function hostMeetingLink(
  origin: string,
  code: string,
  hostKey: string,
): string {
  return `${meetingLink(origin, code)}?h=${encodeURIComponent(hostKey)}`;
}

/** "1:04:22" / "4:07" — for a running clock and a recording length alike. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Initials for the avatar shown when a camera is off — which, in a low-data
 * meeting, is most of the room most of the time.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * How many tile columns for n people at this width. Chosen so a phone held
 * upright never drops below a face you can recognise.
 */
export function tileColumns(count: number, width: number): number {
  if (count <= 1) return 1;
  if (width < 640) return count <= 2 ? 1 : 2;
  if (width < 1024) return count <= 2 ? 2 : count <= 6 ? 2 : 3;
  if (count <= 2) return 2;
  if (count <= 6) return 3;
  if (count <= 12) return 4;
  return 5;
}

export const REACTIONS = ["🙏", "🙌", "👏", "❤️", "🔥", "😂", "👍", "✋"] as const;
export type Reaction = (typeof REACTIONS)[number];

/**
 * Is it time to show the join button for a scheduled meeting? Ten minutes
 * early, and for as long as it could still plausibly be running.
 */
export function isJoinable(m: {
  status: MeetingStatus;
  scheduledFor: Date | string | null;
  durationMin: number;
}): boolean {
  if (m.status === "live") return true;
  if (m.status !== "scheduled") return false;
  if (!m.scheduledFor) return true;
  const start = new Date(m.scheduledFor).getTime();
  const now = Date.now();
  return now >= start - 10 * 60_000 && now <= start + (m.durationMin + 120) * 60_000;
}

/**
 * Roughly where the permission controls live on this device.
 *
 * Only two answers, because only two matter for instructions: a phone or
 * tablet, where the permission sits behind the padlock or the "aA" in the
 * address bar, and a desktop, where it is an icon at the end of the address
 * bar. Any finer distinction is a lie half the time — Chrome on Android and
 * Safari on iPhone differ, but "tap the padlock or aA" covers both without
 * having to guess which.
 *
 * `maxTouchPoints` rather than the user agent: a user agent tells you what a
 * browser wants to be taken for, and Chrome on a touchscreen laptop is not a
 * phone no matter what it says.
 */
/**
 * Can this browser share a screen at all?
 *
 * iOS Safari — and therefore every browser on an iPhone or iPad, since they are
 * all Safari underneath — does not implement `getDisplayMedia`. Not "asks and
 * is refused": the method is not there. The share button was calling it,
 * throwing, and being swallowed by a catch meant for "the person cancelled the
 * picker", so the control did nothing at all and said nothing about why.
 *
 * Checked rather than sniffed for a user agent, so a browser that gains the
 * feature gets it the day it ships.
 */
export function canShareScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Is the device being held upright?
 *
 * Used for the camera, which has to be asked for a portrait frame explicitly —
 * see `setCamera`. `matchMedia` rather than comparing window dimensions,
 * because a keyboard opening changes the height and is not a rotation.
 */
export function isPortrait(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(orientation: portrait)")?.matches ?? false;
}

export function pointerKind(): "touch" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarse && navigator.maxTouchPoints > 0 ? "touch" : "desktop";
}

/* ============================================================
 * Which browser this is
 * ========================================================== */

const DEVICE_KEY = "fi_meet_device";

/**
 * A stable id for this browser profile, made once and kept.
 *
 * Not a person and not a session: a peer id is minted per join, and this
 * outlives all of them. It is what lets the server tell "Daniel's laptop is
 * back after a crash" from "a second Daniel has walked in" — the difference
 * between one tile and two, and the reason somebody could appear three times
 * in their own meeting.
 *
 * Deliberately not derived from anything about the device. A fingerprint built
 * from screen size, fonts and user agent would survive clearing storage, which
 * is exactly why it would be the wrong thing to build: this is a convenience
 * for the person in the room, not an identifier to follow them with. A random
 * value they can erase by clearing site data is the whole design.
 *
 * Returns null when storage is unavailable — private mode, or a browser set to
 * block site data. The server treats that as "no device" and retires nothing,
 * because a duplicate tile is a blemish and refusing somebody entry to their
 * own church's meeting is not.
 */
export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    // Re-issue anything that does not match what the server will accept, so a
    // value left behind by an older build cannot wedge somebody out of the
    // de-duplication for ever.
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;

    const fresh = crypto.randomUUID().replace(/-/g, "");
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/* ============================================================
 * How big a room can be, and how its media travels
 * ========================================================== */

/**
 * The most people a meeting may hold, by plan.
 *
 * A limit on the ROOM, not on the platform. Above `MESH_CEILING` a room needs
 * the SFU, so these numbers are also what the church is paying for: relayed
 * media costs real money per gigabyte, and a plan that promised two hundred
 * people on a Sunday without charging for it would be a plan that loses money
 * every Sunday.
 *
 * `null` is unlimited in the plan's own terms; the host still sets a room
 * limit, and the SFU is still the thing doing the work.
 */
export const MEETING_LIMIT_BY_PLAN: Record<string, number | null> = {
  starter: 12,
  growth: 50,
  pro: 200,
  enterprise: null,
};

/**
 * The most people a peer-to-peer room can hold before it stops working.
 *
 * Not a preference — arithmetic. In a mesh each person uploads one copy per
 * other person, so at eight people a phone is encoding seven streams and
 * pushing about 1.1 Mbit/s up, which is more than most Nigerian mobile uplinks
 * have. `profileFor` is already down to 320x180 by twelve. Six is where the
 * picture is still worth looking at.
 *
 * Audio-only rooms go far past this — twelve people is about 264 kbit/s up —
 * which is why the threshold is applied to the room's LIMIT and not to whoever
 * happens to be in it.
 */
export const MESH_CEILING = 6;

export type MeetingTransport = "mesh" | "sfu";

/**
 * Which transport a room of this size should use.
 *
 * Decided once, before anybody joins, and never changed while a meeting is
 * running: everyone in a room must use the same one, because a mesh peer and
 * an SFU peer cannot see each other at all. Switching mid-call would split a
 * congregation in half at the moment it mattered most.
 *
 * Mesh where mesh works — no server in the media path, the lowest latency
 * available, and it costs nothing to run.
 */
export function chooseTransport(opts: {
  maxParticipants: number;
  sfuAvailable: boolean;
}): MeetingTransport {
  if (!opts.sfuAvailable) return "mesh";
  return opts.maxParticipants > MESH_CEILING ? "sfu" : "mesh";
}

/** The plan's ceiling for a room, or null for unlimited. */
export function meetingLimitFor(plan: string): number | null {
  return plan in MEETING_LIMIT_BY_PLAN ? MEETING_LIMIT_BY_PLAN[plan] : 12;
}

/**
 * Which plans may set a meeting to repeat.
 *
 * A paid upgrade rather than part of meetings, and the distinction is
 * deliberate: Growth can hold a meeting, Pro can stop having to create it. For a
 * church running a midweek prayer meeting, a Bible study and a leadership
 * meeting, that is the difference between twelve set-ups a month and none.
 *
 * An unknown plan id is treated as the lowest, same as every other limit here —
 * a plan we do not recognise must never accidentally mean "everything".
 */
export const REPEAT_PLANS: readonly string[] = ["pro", "enterprise"];

export function canRepeatMeetings(plan: string | null | undefined): boolean {
  return !!plan && REPEAT_PLANS.includes(plan);
}

/**
 * What a participant's tracks are called on the SFU.
 *
 * Fixed rather than generated, because a track is already scoped by the session
 * it belongs to — `(sessionId, "cam")` is unique across the room. It also means
 * a subscriber knows what to ask for without being told anything: seeing
 * somebody in the roster is enough.
 *
 * Here rather than in `sfu.ts` because both halves need the same vocabulary and
 * that module is server-only.
 */
export const TRACK_NAMES = {
  mic: "mic",
  camera: "cam",
  screen: "screen",
} as const;

export type TrackName = (typeof TRACK_NAMES)[keyof typeof TRACK_NAMES];
