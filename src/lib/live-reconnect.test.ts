import { describe, expect, it } from "vitest";
import {
  liveOverlay,
  reconnectDelayMs,
  UNREACHABLE_AFTER,
} from "@/lib/live-reconnect";

/**
 * The watch page promises "it starts on its own". These pin the two halves of
 * keeping that promise: the player keeps trying at a pace a phone can afford,
 * and the overlay never tells an early arrival the broadcast has ended.
 */

describe("reconnectDelayMs", () => {
  it("backs off 3s, 6s, 12s, 24s and then holds at 30s", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(reconnectDelayMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("never waits less than the first step", () => {
    expect(reconnectDelayMs(0)).toBe(3_000);
    expect(reconnectDelayMs(-2)).toBe(3_000);
  });
});

describe("liveOverlay", () => {
  const base = { playing: false, live: true, dropped: false, failures: 0, refused: false };

  it("shows nothing over a picture", () => {
    expect(liveOverlay({ ...base, playing: true, failures: 9, dropped: true })).toBe("none");
  });

  it("keeps an early arrival on 'not started' however many attempts are refused", () => {
    expect(liveOverlay({ ...base, live: false, failures: 40 })).toBe("not-started");
  });

  it("says 'connecting' on a live stream until several attempts in a row fail", () => {
    expect(liveOverlay({ ...base, failures: UNREACHABLE_AFTER - 1 })).toBe("connecting");
    expect(liveOverlay({ ...base, failures: UNREACHABLE_AFTER })).toBe("unreachable");
  });

  it("says 'reconnecting' after a drop, even on a page loaded before it went live", () => {
    expect(liveOverlay({ ...base, live: false, dropped: true, failures: 1 })).toBe(
      "reconnecting",
    );
    expect(
      liveOverlay({ ...base, live: false, dropped: true, failures: UNREACHABLE_AFTER }),
    ).toBe("unreachable");
  });

  it("tells a browser refusing playback apart from a stream it cannot reach", () => {
    expect(liveOverlay({ ...base, refused: true })).toBe("refused");
    expect(liveOverlay({ ...base, live: false, refused: true })).toBe("refused");
  });
});
