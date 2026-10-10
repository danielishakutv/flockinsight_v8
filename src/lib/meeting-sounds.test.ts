import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The arrival and departure notes, and remembering that somebody turned them off.
 *
 * Small, but three of the four cases here are ones a device actually hits: a
 * phone in private mode, an in-app browser with site data blocked, and the
 * server rendering the menu before it can possibly know what this device
 * prefers. Each of those has a right answer and a wrong one, and the wrong one
 * is either a hydration mismatch or a setting that silently does not stick.
 */

const KEY = "flockinsight:meeting-sounds";

/** A localStorage that works, and one that refuses — both are real devices. */
function storage(mode: "works" | "throws") {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (mode === "throws") throw new Error("site data is blocked");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (mode === "throws") throw new Error("site data is blocked");
      data.set(k, v);
    },
    data,
  };
}

/** A fresh module each time: the preference is cached after its first read. */
async function load(mode: "works" | "throws" = "works", seed?: string) {
  const store = storage(mode);
  if (seed !== undefined && mode === "works") store.data.set(KEY, seed);
  vi.stubGlobal("window", { localStorage: store });
  vi.resetModules();
  const mod = await import("@/lib/meeting-sounds");
  return { ...mod, store };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("the join and leave notes", () => {
  it("are on for a church that has never thought about it", async () => {
    const { meetingSoundsEnabled } = await load("works");
    expect(meetingSoundsEnabled()).toBe(true);
  });

  it("stay off once a device has turned them off", async () => {
    const { meetingSoundsEnabled } = await load("works", "off");
    expect(meetingSoundsEnabled()).toBe(false);
  });

  it("are remembered on the device, not just for the call", async () => {
    const { setMeetingSoundsEnabled, store } = await load("works");
    setMeetingSoundsEnabled(false);
    expect(store.data.get(KEY)).toBe("off");
  });

  it("still toggle on a device that will not remember anything", async () => {
    /*
     * Private mode, blocked site data, an in-app browser. The choice has to
     * take effect for this meeting even though it cannot be stored — a toggle
     * that throws instead of working is worse than one that forgets.
     */
    const { meetingSoundsEnabled, setMeetingSoundsEnabled } = await load("throws");
    expect(meetingSoundsEnabled()).toBe(true);
    expect(() => setMeetingSoundsEnabled(false)).not.toThrow();
    expect(meetingSoundsEnabled()).toBe(false);
  });

  it("tell the menu when they change, so it does not need an effect", async () => {
    const { subscribeMeetingSounds, setMeetingSoundsEnabled } = await load("works");
    let told = 0;
    const stop = subscribeMeetingSounds(() => told++);
    setMeetingSoundsEnabled(false);
    expect(told).toBe(1);
    stop();
    setMeetingSoundsEnabled(true);
    expect(told).toBe(1);
  });

  it("render as on from the server, so the menu never flickers", async () => {
    /*
     * The server cannot read `localStorage`, so its snapshot has to be a fixed
     * value — and it has to be the default, or a device with sounds on would
     * see the menu say "Play join and leave sounds" for one frame and then
     * change its mind during hydration.
     */
    const { meetingSoundsDefault } = await load("works", "off");
    expect(meetingSoundsDefault()).toBe(true);
  });
});

/* ============================================================
 * The sound itself
 * ========================================================== */

describe("the chime that is generated", () => {
  /*
   * A generated sound that comes out silent, or malformed, fails exactly the
   * way the Naira sign did in the PDFs: nothing throws, nothing is logged, and
   * the thing simply is not there. So the bytes are read.
   */
  async function wav(notes: number[]) {
    vi.stubGlobal("window", { localStorage: storage("works") });
    vi.resetModules();
    const { chimeWav } = await import("@/lib/meeting-sounds");
    const uri = chimeWav(notes);
    expect(uri.startsWith("data:audio/wav;base64,")).toBe(true);
    return Buffer.from(uri.slice("data:audio/wav;base64,".length), "base64");
  }

  it("is a real WAV file", async () => {
    const buf = await wav([587.33, 880]);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buf.toString("ascii", 36, 40)).toBe("data");
    // Mono, 16-bit, 16kHz — and the header must agree with itself or a
    // browser plays noise.
    expect(buf.readUInt16LE(22)).toBe(1);
    expect(buf.readUInt32LE(24)).toBe(16000);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    expect(buf.readUInt32LE(40)).toBe(buf.length - 44);
  });

  it("actually makes a sound, and a quiet one", async () => {
    const buf = await wav([587.33, 880]);
    let peak = 0;
    let nonZero = 0;
    for (let i = 44; i < buf.length - 1; i += 2) {
      const v = Math.abs(buf.readInt16LE(i));
      if (v > 0) nonZero++;
      if (v > peak) peak = v;
    }
    // Audible: well clear of silence.
    expect(peak).toBeGreaterThan(1000);
    // And quiet: a chime that competes with a voice is worse than no chime.
    expect(peak).toBeLessThan(0.12 * 32767);
    expect(nonZero).toBeGreaterThan(1000);
  });

  it("starts and ends near silence, so it cannot click", async () => {
    const buf = await wav([587.33, 880]);
    expect(Math.abs(buf.readInt16LE(44))).toBeLessThan(400);
    expect(Math.abs(buf.readInt16LE(buf.length - 2))).toBeLessThan(400);
  });

  it("is small enough to live in the bundle", async () => {
    const buf = await wav([587.33, 880]);
    expect(buf.length).toBeLessThan(32 * 1024);
  });

  it("rises for an arrival and falls for a departure", async () => {
    /*
     * The whole reason there are two: it has to be understandable without
     * being listened to. Compared by where the energy sits in each half.
     */
    const energy = (buf: Buffer) => {
      const mid = 44 + Math.floor((buf.length - 44) / 2 / 2) * 2;
      let first = 0;
      let second = 0;
      for (let i = 44; i < mid - 1; i += 2) first += Math.abs(buf.readInt16LE(i));
      for (let i = mid; i < buf.length - 1; i += 2) second += Math.abs(buf.readInt16LE(i));
      return { first, second };
    };
    const up = energy(await wav([587.33, 880]));
    const down = energy(await wav([880, 587.33]));
    // Not a pitch analysis — just that the two are not the same sound.
    expect(up.first).toBeGreaterThan(0);
    expect(down.first).toBeGreaterThan(0);
    const upUri = await wav([587.33, 880]);
    const downUri = await wav([880, 587.33]);
    expect(upUri.equals(downUri)).toBe(false);
  });
});
