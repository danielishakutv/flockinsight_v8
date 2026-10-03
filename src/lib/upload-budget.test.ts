import { describe, expect, it } from "vitest";
import { pauseAfterChunk, uploadBudget } from "@/lib/upload-budget";

/**
 * The rule under test is one sentence: the meeting always wins.
 *
 * Getting this wrong in the generous direction is the expensive mistake. A
 * recording that waits an hour costs nobody anything — the file is on the
 * device either way. A recording that borrows bandwidth from a live service
 * makes the service stutter for everyone in the room, and that is the thing
 * the recording exists to capture.
 */

const inMeeting = (over: Partial<Parameters<typeof uploadBudget>[0]> = {}) =>
  uploadBudget({ inMeeting: true, ...over });
const idle = (over: Partial<Parameters<typeof uploadBudget>[0]> = {}) =>
  uploadBudget({ inMeeting: false, ...over });

describe("during a meeting", () => {
  it("uses only a quarter of what WebRTC says is spare", () => {
    // 4 Mbps spare = 500 KB/s; a quarter is 125 KB/s.
    const b = inMeeting({ availableOutgoingBitrate: 4_000_000 });
    expect(b.send).toBe(true);
    expect(b.limitBytesPerSecond).toBe(Math.floor((4_000_000 / 8) * 0.25));
  });

  it("holds back when there is no spare capacity worth using", () => {
    // 512 kbps spare -> 16 KB/s share, slower than the recording is produced.
    const b = inMeeting({ availableOutgoingBitrate: 512_000 });
    expect(b.send).toBe(false);
    expect(b.reason).toMatch(/upload.*afterwards|spare/i);
  });

  it("stops the moment the meeting starts losing packets", () => {
    const b = inMeeting({ availableOutgoingBitrate: 8_000_000, packetLoss: 0.05 });
    expect(b.send).toBe(false);
    expect(b.reason).toMatch(/losing packets/i);
  });

  it("keeps going when loss is negligible", () => {
    const b = inMeeting({ availableOutgoingBitrate: 8_000_000, packetLoss: 0.001 });
    expect(b.send).toBe(true);
  });

  it("does NOT upload when it has no measurement to go on", () => {
    /*
     * The important one. No estimate means no evidence, and during a meeting
     * the safe reading of no evidence is "do not" — the recording loses nothing
     * by waiting, and the meeting loses a great deal by guessing wrong.
     */
    const b = inMeeting({ availableOutgoingBitrate: null });
    expect(b.send).toBe(false);
  });

  it("never uploads on 2G, however much it claims is spare", () => {
    for (const t of ["2g", "slow-2g"]) {
      const b = inMeeting({ effectiveType: t, availableOutgoingBitrate: 50_000_000 });
      expect(b.send, t).toBe(false);
    }
  });

  it("respects data saver by waiting for the meeting to end", () => {
    const b = inMeeting({ saveData: true, availableOutgoingBitrate: 50_000_000 });
    expect(b.send).toBe(false);
    expect(b.reason).toMatch(/data saver/i);
  });
});

describe("outside a meeting", () => {
  it("uploads at full speed when there is nothing to protect", () => {
    const b = idle({ effectiveType: "4g" });
    expect(b.send).toBe(true);
    expect(b.limitBytesPerSecond).toBeNull();
  });

  it("still goes gently on 3G, so the rest of the app stays usable", () => {
    const b = idle({ effectiveType: "3g" });
    expect(b.send).toBe(true);
    expect(b.limitBytesPerSecond).toBe(128 * 1024);
  });

  it("still refuses 2G, where trying makes everything worse", () => {
    expect(idle({ effectiveType: "2g" }).send).toBe(false);
  });

  it("uploads slowly rather than not at all under data saver", () => {
    // Out of a meeting there is nothing to protect but their data bundle, and
    // a recording that never uploads is the failure this all exists to prevent.
    const b = idle({ saveData: true });
    expect(b.send).toBe(true);
    expect(b.limitBytesPerSecond).toBe(64 * 1024);
  });

  it("works with no signals at all, which is most browsers", () => {
    // Safari offers no Network Information API. It must not be treated as 2G.
    const b = idle({});
    expect(b.send).toBe(true);
  });
});

describe("pacing", () => {
  it("waits out the remainder of a chunk's fair share", () => {
    // 1 MB at 512 KB/s owes exactly 2000ms; it took 500ms, so wait 1500ms.
    expect(pauseAfterChunk(1_048_576, 500, 512 * 1024)).toBe(1500);
  });

  it("does not wait when the chunk already took longer than its share", () => {
    expect(pauseAfterChunk(1_048_576, 9_000, 512 * 1024)).toBe(0);
  });

  it("does not wait at all when there is no limit", () => {
    expect(pauseAfterChunk(1_048_576, 10, null)).toBe(0);
    expect(pauseAfterChunk(1_048_576, 10, 0)).toBe(0);
  });
});

describe("every outcome explains itself", () => {
  it("always gives a sentence a person could read", () => {
    const cases = [
      inMeeting({ availableOutgoingBitrate: 8_000_000 }),
      inMeeting({ availableOutgoingBitrate: 100_000 }),
      inMeeting({ availableOutgoingBitrate: null }),
      inMeeting({ packetLoss: 0.2, availableOutgoingBitrate: 8_000_000 }),
      idle({ effectiveType: "2g" }),
      idle({ saveData: true }),
      idle({}),
    ];
    for (const c of cases) {
      expect(c.reason.length).toBeGreaterThan(10);
      // No status codes or jargon leaking into something a host reads.
      expect(c.reason).not.toMatch(/null|undefined|NaN|bitrate/i);
    }
  });
});
