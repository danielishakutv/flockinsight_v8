import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureVerdict,
  DEAD_ADAPTER_MS,
  deadAdapterReason,
  deadWindowMs,
  describeLink,
  emptyCounts,
  formatClock,
  mergeCounts,
  parseSavedStats,
  STALLED_RECORDER_MESSAGE,
  type AdapterLinkState,
  type CaptureCounts,
} from "./health";

/**
 * A dead adapter used to leave a voice silent for the rest of the recording
 * while /health said "up", and a recording that heard nobody was filed as
 * "ready". These pin the two rules that replaced the guesswork.
 */

const T0 = 1_000_000;

function link(over: Partial<AdapterLinkState>): AdapterLinkState {
  return {
    kind: "mic",
    adapterId: "ad-1",
    sockets: 0,
    createdAt: T0,
    lostAt: null,
    attachedAt: 0,
    lastPacketAt: 0,
    micOnSince: null,
    ...over,
  };
}

describe("when an adapter is dead", () => {
  it("gives the media server its fifteen seconds of retries, and then some", () => {
    const never = link({});
    expect(deadAdapterReason(never, T0 + DEAD_ADAPTER_MS)).toBeNull();
    expect(deadAdapterReason(never, T0 + DEAD_ADAPTER_MS + 1)).toMatch(/never connected/);
  });

  it("times a lost stream from when it was lost, not from when it was granted", () => {
    const lost = link({ lostAt: T0 + 60_000, attachedAt: T0 + 1000 });
    expect(deadAdapterReason(lost, T0 + 70_000)).toBeNull();
    expect(deadAdapterReason(lost, T0 + 81_000)).toMatch(/lost 21s ago/);
  });

  it("leaves alone an adapter not granted yet: that is the create loop's business", () => {
    expect(deadAdapterReason(link({ adapterId: null }), T0 + 10 * 60_000)).toBeNull();
  });

  it("never judges a connected camera on its packets", () => {
    const cam = link({ kind: "cam", sockets: 1, attachedAt: T0, lastPacketAt: T0 });
    expect(deadAdapterReason(cam, T0 + 10 * 60_000)).toBeNull();
  });

  it("never judges a muted microphone, however quiet", () => {
    const muted = link({ sockets: 1, attachedAt: T0, lastPacketAt: T0, micOnSince: null });
    expect(deadAdapterReason(muted, T0 + 10 * 60_000)).toBeNull();
  });

  it("calls a microphone that is on but silent dead, after the grace", () => {
    const on = link({ sockets: 1, attachedAt: T0, lastPacketAt: T0 + 5000, micOnSince: T0 });
    expect(deadAdapterReason(on, T0 + 5000 + DEAD_ADAPTER_MS)).toBeNull();
    expect(deadAdapterReason(on, T0 + 5000 + DEAD_ADAPTER_MS + 1)).toMatch(/nothing has arrived for 20s/);
    const neverHeard = link({ sockets: 1, attachedAt: T0, micOnSince: T0 });
    expect(deadAdapterReason(neverHeard, T0 + 30_000)).toMatch(/not one packet/);
  });

  it("gives an unmute after a long quiet stretch the full grace", () => {
    const unmuted = link({ sockets: 1, attachedAt: T0, lastPacketAt: T0, micOnSince: T0 + 10 * 60_000 });
    expect(deadAdapterReason(unmuted, T0 + 10 * 60_000 + 5000)).toBeNull();
  });

  it("waits longer each time a replacement also delivers nothing, and never longer than 320s", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => deadWindowMs(n) / 1000)).toEqual([20, 40, 80, 160, 320, 320, 320]);
    const silent = link({ sockets: 1, attachedAt: T0, micOnSince: T0 });
    expect(deadAdapterReason(silent, T0 + 30_000, deadWindowMs(1))).toBeNull();
    expect(deadAdapterReason(silent, T0 + 41_000, deadWindowMs(1))).toMatch(/not one packet/);
  });

  it("says connected, never connected, or how long ago it was lost", () => {
    expect(describeLink(link({ sockets: 1 }), T0)).toBe("connected");
    expect(describeLink(link({}), T0 + 5000)).toBe("never connected");
    expect(describeLink(link({ lostAt: T0 }), T0 + 12_000)).toBe("lost 12s ago");
  });
});

function counts(over: Partial<CaptureCounts>): CaptureCounts {
  return { ...emptyCounts(), ...over };
}

describe("whether a recording captured anything", () => {
  it("files anything that heard a packet of sound", () => {
    expect(captureVerdict(counts({ micRequested: 3, micGranted: 3, micAttaches: 3, audioPackets: 1 }))).toEqual({ kind: "ok" });
    // The local smoke test connects straight to the ingest path with no media server.
    expect(captureVerdict(counts({ micRequested: 9, micGranted: 0, micAttaches: 1, audioPackets: 500 })).kind).toBe("ok");
  });

  it("files a recording nobody spoke in, and says so", () => {
    const v = captureVerdict(counts({}));
    expect(v.kind).toBe("note");
    if (v.kind === "note") expect(v.note).toMatch(/Nobody's microphone was on/);
  });

  it("fails one the media server refused, with its words", () => {
    const v = captureVerdict(counts({ micRequested: 4, lastRefusal: "track not found" }));
    expect(v).toEqual({
      kind: "fail",
      reason:
        "Microphone streams were requested from the media server 4 times and it granted none of them (its last answer: track not found), so nothing was captured.",
    });
  });

  it("fails one whose streams never connected, with the numbers", () => {
    expect(captureVerdict(counts({ micRequested: 3, micGranted: 3 }))).toEqual({
      kind: "fail",
      reason: "3 microphone streams were requested from the media server and none of them ever connected, so nothing was captured.",
    });
    const one = captureVerdict(counts({ micRequested: 1, micGranted: 1 }));
    expect(one.kind === "fail" && one.reason).toMatch(/^1 microphone stream was requested/);
  });

  it("fails one that connected but heard nothing", () => {
    const v = captureVerdict(counts({ micRequested: 2, micGranted: 2, micAttaches: 2 }));
    expect(v.kind === "fail" && v.reason).toMatch(/2 connections were made, but not one packet of sound arrived/);
  });

  it("files a silent one that caught real pictures, rather than throwing the pictures away", () => {
    const v = captureVerdict(counts({ micRequested: 4, videoGranted: 1, videoAttaches: 1, videoFrames: 900 }));
    expect(v).toEqual({
      kind: "note",
      note: "Microphone streams were requested from the media server 4 times and it granted none of them, so there is no sound in this recording; the picture is kept.",
    });
    // Off-camera placeholders are not pictures.
    expect(captureVerdict(counts({ micRequested: 4, placeholderFrames: 900 })).kind).toBe("fail");
  });
});

describe("counts across restarts", () => {
  it("adds an earlier process's counts to this one's", () => {
    const merged = mergeCounts(
      counts({ micGranted: 2, audioPackets: 100, lastRefusal: "old" }),
      counts({ micGranted: 1, audioPackets: 50 }),
    );
    expect(merged.micGranted).toBe(3);
    expect(merged.audioPackets).toBe(150);
    expect(merged.lastRefusal).toBe("old");
    expect(mergeCounts(counts({ lastRefusal: "old" }), counts({ lastRefusal: "new" })).lastRefusal).toBe("new");
  });

  it("reads back what it saved, and nothing it should not trust", () => {
    const saved = JSON.stringify({ complete: true, counts: counts({ micAttaches: 4, audioPackets: 9 }) });
    expect(parseSavedStats(saved)).toEqual({ counts: counts({ micAttaches: 4, audioPackets: 9 }), complete: true });

    expect(parseSavedStats('{"complete":true,"counts":{"micAtta')).toBeNull(); // torn by a crash
    expect(parseSavedStats("null")).toBeNull();
    expect(parseSavedStats('{"complete":true}')).toBeNull();

    const odd = parseSavedStats('{"counts":{"audioPackets":"x","micGranted":-5,"videoFrames":7}}');
    expect(odd?.complete).toBe(false);
    expect(odd?.counts.audioPackets).toBe(0);
    expect(odd?.counts.micGranted).toBe(0);
    expect(odd?.counts.videoFrames).toBe(7);
  });
});

describe("the small print", () => {
  it("writes a position in the recording as a clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3754)).toBe("1:02:34");
  });

  it("recognises the app's stalled-recorder words exactly", () => {
    // Copied, not imported (see health.ts). If the app's words change, the
    // start-up recovery silently stops finding the rows — so this fails first.
    const src = readFileSync(join(import.meta.dirname, "..", "lib", "meetings.ts"), "utf8");
    const m = /export const STALLED_RECORDER_GONE\s*=\s*"([^"]*)"/.exec(src);
    expect(m?.[1]).toBe(STALLED_RECORDER_MESSAGE);
  });
});
