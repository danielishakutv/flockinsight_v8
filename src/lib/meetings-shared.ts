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
  /** Per-peer audio ceiling, bits per second. */
  audioBitrate: number;
  label: string;
};

export const AUDIO_ONLY_PROFILE: BandwidthProfile = {
  maxWidth: 0,
  maxHeight: 0,
  frameRate: 0,
  videoBitrate: 0,
  audioBitrate: 20000,
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
  if (opts.lowData) return AUDIO_ONLY_PROFILE;

  // A shared screen is text more often than motion: keep it readable and let
  // the frame rate go rather than blurring the words.
  if (opts.screen) {
    const poor = opts.link === "poor" || opts.link === "lost";
    return {
      maxWidth: poor ? 1280 : 1920,
      maxHeight: poor ? 720 : 1080,
      frameRate: poor ? 3 : 8,
      videoBitrate: poor ? 250_000 : 800_000,
      audioBitrate: 24000,
      label: poor ? "Screen (light)" : "Screen",
    };
  }

  const peers = Math.max(1, opts.peers);
  let tier: BandwidthProfile;
  if (peers <= 1) {
    tier = {
      maxWidth: 1280,
      maxHeight: 720,
      frameRate: 24,
      videoBitrate: 700_000,
      audioBitrate: 32000,
      label: "HD",
    };
  } else if (peers <= 3) {
    tier = {
      maxWidth: 640,
      maxHeight: 360,
      frameRate: 20,
      videoBitrate: 300_000,
      audioBitrate: 28000,
      label: "Standard",
    };
  } else if (peers <= 7) {
    tier = {
      maxWidth: 480,
      maxHeight: 270,
      frameRate: 15,
      videoBitrate: 160_000,
      audioBitrate: 24000,
      label: "Light",
    };
  } else {
    tier = {
      maxWidth: 320,
      maxHeight: 180,
      frameRate: 12,
      videoBitrate: 90_000,
      audioBitrate: 20000,
      label: "Very light",
    };
  }

  if (opts.link === "poor" || opts.link === "lost") {
    return {
      maxWidth: Math.min(tier.maxWidth, 320),
      maxHeight: Math.min(tier.maxHeight, 180),
      frameRate: 10,
      videoBitrate: Math.min(tier.videoBitrate, 80_000),
      audioBitrate: 20000,
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
}): MeetingQuality {
  const { packetLossPct: loss, rttMs: rtt } = opts;
  if (loss >= 12 || rtt >= 1200) return "poor";
  if (loss >= 4 || rtt >= 500) return "fair";
  if (opts.availableOutgoing && opts.availableOutgoing > 0 && opts.availableOutgoing < 60_000)
    return "poor";
  return "good";
}

export const QUALITY_LABEL: Record<MeetingQuality, string> = {
  good: "Good connection",
  fair: "Connection is a bit weak",
  poor: "Very weak connection",
  lost: "Reconnecting…",
};

/* ============================================================
 * Opus tuning
 *
 * Browsers negotiate Opus at ~32-40kbps stereo by default, which is generous
 * for music and wasteful for a voice. DTX stops sending during silence — in a
 * meeting where one person talks and nine listen, that alone is most of the
 * saving. FEC carries a copy of the previous frame so a single lost packet
 * does not punch a hole in a word.
 * ========================================================== */

export function tuneOpus(sdp: string, bitrate = 24000): string {
  const payload = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!payload) return sdp;

  const wanted = [
    "stereo=0",
    "sprop-stereo=0",
    "useinbandfec=1",
    "usedtx=1",
    `maxaveragebitrate=${bitrate}`,
    // 60ms packets: a third of the header overhead of the 20ms default, which
    // is a real saving when the payload itself is only ~20kbps.
    "ptime=60",
    "maxptime=120",
  ].join(";");

  const fmtp = new RegExp(`a=fmtp:${payload} (.*)`);
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_m, existing: string) => {
      // Keep anything the browser put there that we are not overriding.
      const keep = existing
        .split(";")
        .filter((p) => {
          const key = p.split("=")[0]?.trim();
          return (
            key &&
            ![
              "stereo",
              "sprop-stereo",
              "useinbandfec",
              "usedtx",
              "maxaveragebitrate",
              "ptime",
              "maxptime",
            ].includes(key)
          );
        })
        .join(";");
      return `a=fmtp:${payload} ${keep ? `${keep};` : ""}${wanted}`;
    });
  }
  return sdp.replace(
    new RegExp(`(a=rtpmap:${payload} opus/48000.*\r?\n)`),
    `$1a=fmtp:${payload} ${wanted}\r\n`,
  );
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
