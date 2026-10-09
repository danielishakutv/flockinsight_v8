import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_ONLY_PROFILE,
  audioProfileFor,
  audioShapeKey,
  audioWireBitrate,
  deviceId,
  EMPTY_STAGE,
  formatDuration,
  generateMeetingCode,
  generatePasscode,
  initialsOf,
  isJoinable,
  isPolite,
  mediaRights,
  normaliseMeetingCode,
  parseStage,
  profileFor,
  rateLink,
  shouldInitiate,
  tileColumns,
  tuneOpus,
} from "@/lib/meetings-shared";

/* ============================================================
 * Join codes
 * ========================================================== */

describe("meeting codes", () => {
  it("uses an alphabet with nothing that can be misheard or misread", () => {
    // A code gets read out from a pulpit and typed by somebody in a hurry.
    const banned = /[aeiou01l5s2zAEIOU]/;
    for (let i = 0; i < 300; i++) {
      expect(generateMeetingCode()).not.toMatch(banned);
    }
  });

  it("is grouped as xxx-xxxx-xxx", () => {
    expect(generateMeetingCode()).toMatch(/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateMeetingCode()));
    expect(seen.size).toBe(500);
  });

  it("tidies up whatever a person actually types", () => {
    expect(normaliseMeetingCode("BCD FGHJ KMN")).toBe("bcd-fghj-kmn");
    expect(normaliseMeetingCode("bcdfghjkmn")).toBe("bcd-fghj-kmn");
    expect(normaliseMeetingCode("bcd-fghj-kmn")).toBe("bcd-fghj-kmn");
    // Half a code stays half a code rather than being padded into a wrong one.
    expect(normaliseMeetingCode("bcd")).toBe("bcd");
  });

  it("makes a six-digit passcode", () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePasscode()).toMatch(/^\d{6}$/);
    }
    expect(generatePasscode(() => 0)).toBe("100000");
    expect(generatePasscode(() => 0.999999)).toBe("999999");
  });
});

/* ============================================================
 * Negotiation
 * ========================================================== */

describe("who calls whom", () => {
  it("picks exactly one caller for any pair", () => {
    const a = "aaa";
    const b = "bbb";
    expect(shouldInitiate(a, b)).toBe(true);
    expect(shouldInitiate(b, a)).toBe(false);
  });

  it("makes exactly one side of a pair polite, and never the caller", () => {
    // Two impolite peers deadlock on a glare; two polite ones both give way.
    const pairs = [
      ["a", "b"],
      ["zzz", "aaa"],
      ["9", "1"],
    ];
    for (const [x, y] of pairs) {
      expect(isPolite(x, y)).not.toBe(isPolite(y, x));
      expect(isPolite(x, y)).toBe(!shouldInitiate(x, y));
    }
  });
});

/* ============================================================
 * Bandwidth
 * ========================================================== */

describe("bandwidth profiles", () => {
  it("drops to audio only in low-data mode, whatever else is true", () => {
    expect(profileFor({ peers: 1, lowData: true })).toEqual(AUDIO_ONLY_PROFILE);
    expect(profileFor({ peers: 9, lowData: true, link: "good" })).toEqual(
      AUDIO_ONLY_PROFILE,
    );
    expect(profileFor({ peers: 1, lowData: true, screen: true })).toEqual(
      AUDIO_ONLY_PROFILE,
    );
  });

  it("spends less per peer as the room grows", () => {
    // The whole point of a mesh budget: your upload is per-peer, so a bigger
    // room has to mean a smaller stream or the phone gives up.
    const one = profileFor({ peers: 1, lowData: false });
    const four = profileFor({ peers: 4, lowData: false });
    const ten = profileFor({ peers: 10, lowData: false });

    expect(one.videoBitrate).toBeGreaterThan(four.videoBitrate);
    expect(four.videoBitrate).toBeGreaterThan(ten.videoBitrate);
    expect(one.maxHeight).toBeGreaterThanOrEqual(four.maxHeight);
    expect(four.maxHeight).toBeGreaterThanOrEqual(ten.maxHeight);
  });

  it("keeps the total upload inside a realistic budget", () => {
    // videoBitrate is per peer, so the bill is bitrate x peers. 3G upload in
    // the places this is built for is often under 1Mbps.
    for (const peers of [1, 2, 4, 6, 8, 12]) {
      const p = profileFor({ peers, lowData: false });
      const total = (p.videoBitrate + audioWireBitrate(p.audio)) * peers;
      expect(total, `${peers} peers`).toBeLessThanOrEqual(1_500_000);
    }
  });

  it("cuts back further on a poor link", () => {
    const good = profileFor({ peers: 2, lowData: false, link: "good" });
    const fair = profileFor({ peers: 2, lowData: false, link: "fair" });
    const poor = profileFor({ peers: 2, lowData: false, link: "poor" });

    expect(fair.videoBitrate).toBeLessThan(good.videoBitrate);
    expect(poor.videoBitrate).toBeLessThan(fair.videoBitrate);
    expect(poor.frameRate).toBeLessThanOrEqual(fair.frameRate);
  });

  it("keeps a shared screen readable rather than smooth", () => {
    const screen = profileFor({ peers: 4, lowData: false, screen: true });
    const faces = profileFor({ peers: 4, lowData: false });
    // Words on a slide need pixels; a face needs frames.
    expect(screen.maxWidth).toBeGreaterThan(faces.maxWidth);
    expect(screen.frameRate).toBeLessThan(faces.frameRate);
  });

  it("never returns a zero audio budget while anyone can hear", () => {
    for (const peers of [1, 5, 20]) {
      expect(profileFor({ peers, lowData: false }).audio.bitrate).toBeGreaterThan(0);
    }
    expect(AUDIO_ONLY_PROFILE.audio.bitrate).toBeGreaterThan(0);
  });

  it("does not let a bigger room make the voice worse", () => {
    // Video gets cheaper as the room grows; speech must not. A twelve-person
    // prayer meeting is exactly where being heard matters most.
    const two = profileFor({ peers: 2, lowData: false });
    const twelve = profileFor({ peers: 12, lowData: false });
    expect(twelve.audio).toEqual(two.audio);
  });
});

/* ============================================================
 * Audio
 * ========================================================== */

describe("the voice", () => {
  it("makes Data Saver genuinely lighter on the ear as well as the eye", () => {
    // The bug this fixes: Data Saver turned the camera off and left the
    // microphone costing exactly what it did before.
    const normal = profileFor({ peers: 3, lowData: false, link: "good" });
    const saving = profileFor({ peers: 3, lowData: true, link: "good" });

    expect(saving.videoBitrate).toBe(0);
    expect(saving.audio.bitrate).toBeLessThan(normal.audio.bitrate);
    expect(audioWireBitrate(saving.audio)).toBeLessThan(
      audioWireBitrate(normal.audio),
    );
    // Narrowed to the band a voice lives in, rather than left to the browser.
    expect(saving.audio.maxBandwidth).toBeGreaterThan(0);
  });

  it("buys redundancy out of what it saved when the link struggles", () => {
    const calm = audioProfileFor({ lowData: true, link: "good" });
    const rough = audioProfileFor({ lowData: true, link: "poor" });

    expect(calm.redundancy).toBe(false);
    expect(rough.redundancy).toBe(true);
    // Fewer bits of voice, more copies of them.
    expect(rough.bitrate).toBeLessThan(calm.bitrate);
    // And still no more expensive on the wire than plain audio used to be.
    expect(audioWireBitrate(rough)).toBeLessThan(30_000);
  });

  it("holds more audio back the worse the link gets", () => {
    const good = audioProfileFor({ lowData: false, link: "good" });
    const fair = audioProfileFor({ lowData: false, link: "fair" });
    const poor = audioProfileFor({ lowData: false, link: "poor" });

    expect(fair.jitterBufferMs).toBeGreaterThan(good.jitterBufferMs);
    expect(poor.jitterBufferMs).toBeGreaterThan(fair.jitterBufferMs);
    // "lost" is a link in the middle of recovering, and is treated as poor.
    expect(audioProfileFor({ lowData: false, link: "lost" })).toEqual(poor);
  });

  it("never turns FEC or DTX off, whatever else it decides", () => {
    for (const lowData of [true, false]) {
      for (const link of ["good", "fair", "poor", "lost"] as const) {
        const a = audioProfileFor({ lowData, link });
        expect(a.fec, `${lowData}/${link}`).toBe(true);
        expect(a.dtx, `${lowData}/${link}`).toBe(true);
      }
    }
  });

  it("counts headers and redundancy in what a voice costs", () => {
    const plain = audioProfileFor({ lowData: false, link: "good" });
    // 24kbps of Opus is not 24kbps on the wire: 40 bytes of IP, UDP and RTP
    // ride on every packet, and at 60ms packets that is another ~5kbps.
    expect(audioWireBitrate(plain)).toBeGreaterThan(plain.bitrate);

    const redundant = { ...plain, redundancy: true };
    expect(audioWireBitrate(redundant)).toBeGreaterThan(audioWireBitrate(plain));
  });

  it("only asks for a new offer when the SDP would actually differ", () => {
    const base = audioProfileFor({ lowData: false, link: "good" });
    // A different target is a runtime change — no renegotiation.
    expect(audioShapeKey({ ...base, bitrate: 9000 })).toBe(audioShapeKey(base));
    expect(audioShapeKey({ ...base, jitterBufferMs: 900 })).toBe(
      audioShapeKey(base),
    );
    // Redundancy is not.
    expect(audioShapeKey({ ...base, redundancy: true })).not.toBe(
      audioShapeKey(base),
    );
  });
});

describe("rating a connection", () => {
  it("calls a clean link good", () => {
    expect(rateLink({ packetLossPct: 0, rttMs: 40 })).toBe("good");
    expect(rateLink({ packetLossPct: 1.5, rttMs: 180 })).toBe("good");
  });

  it("treats loss as worse than latency", () => {
    // 400ms of delay is barely noticed; 5% loss eats words.
    expect(rateLink({ packetLossPct: 5, rttMs: 60 })).toBe("fair");
    expect(rateLink({ packetLossPct: 0, rttMs: 400 })).toBe("good");
  });

  it("calls heavy loss poor", () => {
    expect(rateLink({ packetLossPct: 15, rttMs: 50 })).toBe("poor");
    expect(rateLink({ packetLossPct: 0, rttMs: 1500 })).toBe("poor");
  });

  it("hears what the person hears, not only what they send", () => {
    /*
     * The gap this closes: every other input is about the uplink, so a phone
     * with a fine uplink and a gusty downlink rated itself "good" and sat on
     * the smallest jitter buffer while the voices broke up in its ear.
     * Concealment is the share of speech the player had to invent.
     */
    expect(
      rateLink({ packetLossPct: 0, rttMs: 40, audioConcealedPct: 0.2 }),
    ).toBe("good");
    expect(rateLink({ packetLossPct: 0, rttMs: 40, audioConcealedPct: 3 })).toBe(
      "fair",
    );
    expect(rateLink({ packetLossPct: 0, rttMs: 40, audioConcealedPct: 20 })).toBe(
      "poor",
    );
  });

  it("believes the browser when it says there is no headroom", () => {
    expect(
      rateLink({ packetLossPct: 0, rttMs: 50, availableOutgoing: 30_000 }),
    ).toBe("poor");
    // Zero means "unknown", not "none" — that must not read as a bad link.
    expect(rateLink({ packetLossPct: 0, rttMs: 50, availableOutgoing: 0 })).toBe(
      "good",
    );
  });
});

/* ============================================================
 * Opus SDP
 * ========================================================== */

describe("opus tuning", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=rtpmap:111 opus/48000/2",
    "",
  ].join("\r\n");

  /** The same SDP as a browser that also offers RED writes it. */
  const withRed = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 103",
    "a=rtpmap:111 opus/48000/2",
    "a=rtpmap:63 red/48000/2",
    "a=fmtp:63 111/111",
    "a=rtpmap:103 ISAC/16000",
    "",
  ].join("\r\n");

  const plain = audioProfileFor({ lowData: false, link: "good" });
  const protect = audioProfileFor({ lowData: false, link: "poor" });

  it("adds DTX and FEC when the browser offered no fmtp line", () => {
    const out = tuneOpus(sdp, plain);
    expect(out).toContain("usedtx=1");
    expect(out).toContain("useinbandfec=1");
    expect(out).toContain(`maxaveragebitrate=${plain.bitrate}`);
    expect(out).toContain("stereo=0");
  });

  it("keeps what the browser put there and overrides only our own keys", () => {
    const withFmtp = sdp.replace(
      "a=rtpmap:111 opus/48000/2",
      "a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0;cbr=1",
    );
    const out = tuneOpus(withFmtp, plain);
    expect(out).toContain("minptime=10");
    expect(out).toContain("cbr=1");
    expect(out).toContain("useinbandfec=1");
    expect(out).not.toContain("useinbandfec=0");
    // One fmtp line for the payload, not two.
    expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
  });

  it("narrows the encoder, not just the player, when the band is capped", () => {
    // maxplaybackrate alone says what we can PLAY. sprop-maxcapturerate is
    // what stops our own encoder spending bits above a voice, and it is the
    // half that makes Data Saver cheaper rather than merely politer.
    const saving = audioProfileFor({ lowData: true, link: "good" });
    const out = tuneOpus(sdp, saving);
    expect(out).toContain(`maxplaybackrate=${saving.maxBandwidth}`);
    expect(out).toContain(`sprop-maxcapturerate=${saving.maxBandwidth}`);

    // And leaves the choice alone when the profile does not cap it.
    expect(tuneOpus(sdp, plain)).not.toContain("sprop-maxcapturerate");
  });

  it("puts RED at the head of the m-line to switch redundancy on", () => {
    const out = tuneOpus(withRed, protect);
    expect(out).toContain("m=audio 9 UDP/TLS/RTP/SAVPF 63 111 103");
    // Nothing is dropped — the other payloads are still on offer.
    expect(out).toContain("a=rtpmap:63 red/48000/2");
    expect(out).toContain("a=rtpmap:103 ISAC/16000");
  });

  it("puts opus back at the head to switch it off again", () => {
    const on = tuneOpus(withRed, protect);
    const off = tuneOpus(on, plain);
    expect(off).toContain("m=audio 9 UDP/TLS/RTP/SAVPF 111 63 103");
  });

  it("asks for RED it cannot have without breaking anything", () => {
    // Firefox and Safari offer no RED for Opus. They must still get the
    // tuning, and must not end up with an m-line naming a payload that does
    // not exist.
    const out = tuneOpus(sdp, protect);
    expect(out).toContain("m=audio 9 UDP/TLS/RTP/SAVPF 111");
    expect(out).toContain("usedtx=1");
  });

  it("leaves an SDP with no opus alone", () => {
    const videoOnly = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
    expect(tuneOpus(videoOnly)).toBe(videoOnly);
  });
});

/* ============================================================
 * Who may be heard and seen
 * ========================================================== */

describe("media rights", () => {
  const open = { allowAttendeeMic: true, allowAttendeeCamera: true };
  const locked = { allowAttendeeMic: false, allowAttendeeCamera: false };

  it("lets everyone speak in an ordinary meeting", () => {
    for (const role of ["host", "cohost", "speaker", "attendee"] as const) {
      expect(mediaRights(role, open)).toEqual({ mic: true, camera: true });
    }
  });

  it("keeps the platform live when the room is locked down", () => {
    expect(mediaRights("host", locked)).toEqual({ mic: true, camera: true });
    expect(mediaRights("cohost", locked)).toEqual({ mic: true, camera: true });
    // A speaker is the host's way of handing one person the microphone
    // without handing them the room.
    expect(mediaRights("speaker", locked)).toEqual({ mic: true, camera: true });
    expect(mediaRights("attendee", locked)).toEqual({ mic: false, camera: false });
  });

  it("locks the two halves separately", () => {
    const quiet = { allowAttendeeMic: true, allowAttendeeCamera: false };
    expect(mediaRights("attendee", quiet)).toEqual({ mic: true, camera: false });
  });

  it("treats a role it does not recognise as an attendee", () => {
    // Nothing should ever send one, and if something does, the safe answer in
    // a locked room is the quiet one.
    expect(mediaRights("stagehand", locked)).toEqual({ mic: false, camera: false });
  });
});

/* ============================================================
 * The stage
 * ========================================================== */

describe("reading a stage back out of the database", () => {
  it("treats anything unrecognised as an empty stage", () => {
    expect(parseStage(null)).toEqual(EMPTY_STAGE);
    expect(parseStage({})).toEqual(EMPTY_STAGE);
    expect(parseStage("nonsense")).toEqual(EMPTY_STAGE);
    expect(parseStage({ kind: "wat", rev: 3 })).toEqual({ kind: "none", rev: 3 });
  });

  it("keeps a verse", () => {
    const stage = parseStage({
      kind: "verse",
      reference: "John 3:16",
      translation: "kjv",
      body: "For God so loved the world…",
      rev: 2,
    });
    expect(stage).toMatchObject({ kind: "verse", reference: "John 3:16", rev: 2 });
  });

  it("refuses a verse with no text — an empty screen is not a verse", () => {
    expect(parseStage({ kind: "verse", reference: "John 3:16", body: "" })).toEqual(
      EMPTY_STAGE,
    );
  });

  it("clamps a slide index that has run past the deck", () => {
    const stage = parseStage({
      kind: "slide",
      slides: ["a", "b"],
      urls: ["http://x/1.png", "http://x/2.png"],
      index: 9,
      rev: 1,
    });
    expect(stage.kind).toBe("slide");
    if (stage.kind === "slide") expect(stage.index).toBe(0);
  });

  it("drops a slide stage with no images to show", () => {
    expect(parseStage({ kind: "slide", slides: ["a"], urls: [], index: 0 })).toEqual(
      EMPTY_STAGE,
    );
  });
});

/* ============================================================
 * Presentation helpers
 * ========================================================== */

describe("small helpers", () => {
  it("formats a running clock", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(247)).toBe("4:07");
    expect(formatDuration(3862)).toBe("1:04:22");
    // A negative clock is a bug upstream, not something to render.
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("makes initials from a name", () => {
    expect(initialsOf("Grace Okoro")).toBe("GO");
    expect(initialsOf("Grace")).toBe("GR");
    expect(initialsOf("  Grace   Adaeze  Okoro ")).toBe("GO");
    expect(initialsOf("")).toBe("?");
  });

  it("never squeezes a phone below two columns", () => {
    expect(tileColumns(2, 380)).toBe(1);
    expect(tileColumns(6, 380)).toBe(2);
    expect(tileColumns(20, 380)).toBe(2);
    expect(tileColumns(20, 1440)).toBe(5);
  });

  it("opens a scheduled meeting ten minutes early and not a day before", () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const later = new Date(Date.now() + 5 * 60 * 60_000).toISOString();

    expect(isJoinable({ status: "scheduled", scheduledFor: soon, durationMin: 60 })).toBe(
      true,
    );
    expect(
      isJoinable({ status: "scheduled", scheduledFor: later, durationMin: 60 }),
    ).toBe(false);
    // A live meeting is always joinable; an ended one never is.
    expect(isJoinable({ status: "live", scheduledFor: later, durationMin: 60 })).toBe(
      true,
    );
    expect(isJoinable({ status: "ended", scheduledFor: soon, durationMin: 60 })).toBe(
      false,
    );
  });
});

/* ============================================================
 * Which browser this is
 * ========================================================== */

describe("deviceId", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      matchMedia: () => ({ matches: false }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the same id across calls, which is the whole point", () => {
    const first = deviceId();
    expect(first).not.toBeNull();
    expect(deviceId()).toBe(first);
  });

  it("issues one the server will accept", () => {
    // The join route validates against exactly this shape and drops anything
    // else, so an id that fails here is an id that silently stops
    // de-duplicating anybody.
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("replaces a value an older build left behind", () => {
    store.set("fi_meet_device", "not a valid id!!");
    const fresh = deviceId();
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // And it sticks, rather than being re-issued on every join.
    expect(deviceId()).toBe(fresh);
  });

  it("returns null rather than throwing when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    // Private mode, or a browser set to block site data. The server treats
    // null as "no device" and retires nothing — a duplicate tile is a
    // blemish, being unable to join your own church's meeting is not.
    expect(deviceId()).toBeNull();
  });
});
