import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_ONLY_PROFILE,
  deviceId,
  EMPTY_STAGE,
  formatDuration,
  generateMeetingCode,
  generatePasscode,
  initialsOf,
  isJoinable,
  isPolite,
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
      const total = (p.videoBitrate + p.audioBitrate) * peers;
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
      expect(profileFor({ peers, lowData: false }).audioBitrate).toBeGreaterThan(0);
    }
    expect(AUDIO_ONLY_PROFILE.audioBitrate).toBeGreaterThan(0);
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

  it("adds DTX and FEC when the browser offered no fmtp line", () => {
    const out = tuneOpus(sdp, 24000);
    expect(out).toContain("usedtx=1");
    expect(out).toContain("useinbandfec=1");
    expect(out).toContain("maxaveragebitrate=24000");
    expect(out).toContain("stereo=0");
  });

  it("keeps what the browser put there and overrides only our own keys", () => {
    const withFmtp = sdp.replace(
      "a=rtpmap:111 opus/48000/2",
      "a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0;cbr=1",
    );
    const out = tuneOpus(withFmtp, 20000);
    expect(out).toContain("minptime=10");
    expect(out).toContain("cbr=1");
    expect(out).toContain("useinbandfec=1");
    expect(out).not.toContain("useinbandfec=0");
    // One fmtp line for the payload, not two.
    expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
  });

  it("leaves an SDP with no opus alone", () => {
    const videoOnly = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
    expect(tuneOpus(videoOnly)).toBe(videoOnly);
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
