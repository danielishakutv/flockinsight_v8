import { describe, expect, it } from "vitest";
import {
  AudioMixer,
  FRAME_SAMPLES,
  SAMPLE_RATE,
  toPcmBytes,
  toStereoBytes,
} from "./mixer";

/**
 * The mixer is the part of a server recording that decides whether a voice is
 * in the file, late, early, or missing. These pin the sample-level rules.
 */

const frame = (value: number, samples = FRAME_SAMPLES) =>
  toStereoBytes(new Array(samples).fill(value));

/** Feed `ms` of a constant value into one source. */
function feed(m: AudioMixer, id: string, value: number, ms: number) {
  m.push(id, frame(value, Math.round((SAMPLE_RATE * ms) / 1000)));
}

describe("one source", () => {
  it("is silent until it has primed, then plays what it holds", () => {
    const m = new AudioMixer({ primeMs: 100, maxDepthMs: 600 });
    m.addSource("a");
    feed(m, "a", 1000, 60); // not yet enough to prime
    expect([...m.pull(1)].every((v) => v === 0)).toBe(true);

    feed(m, "a", 1000, 60); // 120ms held now
    const out = m.pull(1);
    expect(out[0]).toBe(1000);
    expect(out[FRAME_SAMPLES - 1]).toBe(1000);
  });

  it("downmixes stereo by averaging the pair", () => {
    const m = new AudioMixer({ primeMs: 20, maxDepthMs: 600 });
    m.addSource("a");
    const bytes = new Uint8Array(FRAME_SAMPLES * 2 * 4);
    for (let i = 0; i < FRAME_SAMPLES * 2; i++) {
      // left = 200, right = 400 -> 300
      bytes.set([200 & 0xff, 200 >> 8, 400 & 0xff, 400 >> 8], i * 4);
    }
    m.push("a", bytes);
    expect(m.pull(1)[10]).toBe(300);
  });

  it("reads negative samples correctly", () => {
    const m = new AudioMixer({ primeMs: 20, maxDepthMs: 600 });
    m.addSource("a");
    feed(m, "a", -1234, 40);
    expect(m.pull(1)[5]).toBe(-1234);
  });

  it("goes quiet when it runs dry, and primes again before resuming", () => {
    const m = new AudioMixer({ primeMs: 100, maxDepthMs: 600 });
    m.addSource("a");
    feed(m, "a", 500, 120);
    m.pull(5); // drains 100ms, leaving 20ms
    m.pull(1); // takes the last frame
    expect(m.pull(1)[0]).toBe(0); // dry

    feed(m, "a", 500, 40); // 40ms is below the prime depth
    expect(m.pull(1)[0]).toBe(0);
    feed(m, "a", 500, 80); // now 120ms
    expect(m.pull(1)[0]).toBe(500);
  });

  it("catches up by dropping the oldest audio when a source piles up", () => {
    /*
     * A burst after a reconnect must not leave a voice permanently behind the
     * room. The ring holds 600ms; pushing 700ms keeps only the newest.
     */
    const m = new AudioMixer({ primeMs: 100, maxDepthMs: 600 });
    m.addSource("a");
    feed(m, "a", 1, 500);
    feed(m, "a", 2, 200); // overflow: most of the 1s go, the 2s stay
    expect(m.droppedSamples("a")).toBeGreaterThan(0);
    // Down to the prime depth of old audio plus the new chunk: 100 + 200 ms.
    expect(m.depthMs("a")).toBeCloseTo(300, 0);
    // The 100ms kept for continuity plays first, then the new audio.
    m.pull(5);
    expect(m.pull(1)[0]).toBe(2);
  });

  it("ignores a push for a source it no longer has", () => {
    const m = new AudioMixer();
    m.addSource("a");
    m.removeSource("a");
    expect(() => feed(m, "a", 9, 20)).not.toThrow();
    expect(m.pull(1)[0]).toBe(0);
  });
});

describe("several sources", () => {
  it("sums the voices that have sound and treats the rest as silence", () => {
    const m = new AudioMixer({ primeMs: 20, maxDepthMs: 600 });
    m.addSource("a");
    m.addSource("b");
    m.addSource("quiet");
    feed(m, "a", 100, 40);
    feed(m, "b", 250, 40);
    const out = m.pull(1);
    expect(out[0]).toBe(350);
    expect(m.framesMixed("a")).toBe(1);
    expect(m.framesMixed("quiet")).toBe(0);
  });

  it("clamps rather than wraps when two loud voices overlap", () => {
    const m = new AudioMixer({ primeMs: 20, maxDepthMs: 600 });
    m.addSource("a");
    m.addSource("b");
    feed(m, "a", 30000, 40);
    feed(m, "b", 30000, 40);
    const out = m.pull(2);
    expect(out[0]).toBe(32767);
    expect(out[FRAME_SAMPLES]).toBe(32767);
    // Both drained: one silent frame while they prime again.
    expect(m.pull(1)[0]).toBe(0);
    feed(m, "a", -30000, 40);
    feed(m, "b", -30000, 40);
    expect(m.pull(1)[0]).toBe(-32768);
  });

  it("always returns exactly the frames asked for", () => {
    const m = new AudioMixer();
    expect(m.pull(3).length).toBe(3 * FRAME_SAMPLES);
    expect(m.pull(0).length).toBe(0);
  });
});

describe("byte helpers", () => {
  it("round-trips mono samples through stereo bytes and back", () => {
    const m = new AudioMixer({ primeMs: 20, maxDepthMs: 600 });
    m.addSource("a");
    const mono = Array.from({ length: FRAME_SAMPLES }, (_, i) => (i * 37) % 65536 - 32768);
    m.push("a", toStereoBytes(mono));
    const out = m.pull(1);
    expect([...out]).toEqual(mono);
    const bytes = toPcmBytes(out);
    expect(bytes.length).toBe(FRAME_SAMPLES * 2);
    expect(bytes[0] | (bytes[1] << 8)).toBe(mono[0] & 0xffff);
  });
});
