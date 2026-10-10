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
