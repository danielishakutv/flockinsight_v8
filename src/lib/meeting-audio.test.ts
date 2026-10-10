import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingClient } from "@/lib/meeting-client";
import type { MeetingRole, RosterEntry } from "@/lib/meetings-shared";

/**
 * The voice, and who is allowed to use one.
 *
 * Two things live here, and they share a harness because they share a failure:
 * a microphone that is not working and says nothing about it.
 *
 * The first is a room locked down to its leaders — a service, a class, a board
 * meeting. The control has to be GONE rather than ignored, and it has to come
 * back the moment a host hands somebody the microphone, without that person
 * reloading anything.
 *
 * The second is a local microphone track dying mid-call, which happens far
 * more often than anybody expects: a headset unplugged, Bluetooth handing
 * over, Android giving the device to an incoming call. Nothing threw, nothing
 * reached the interface, and the person went on talking to a room that could
 * not hear them. That is a large part of "my audio cut out and never came
 * back", and none of it was a network problem.
 */

type Handler = () => void;

type FakeTrack = {
  kind: "audio" | "video";
  enabled: boolean;
  stopped: boolean;
  readyState: "live" | "ended";
  stop: () => void;
  addEventListener: (name: string, fn: Handler) => void;
  /** Fire an event the browser would have fired. */
  emit: (name: string) => void;
};

function fakeTrack(kind: "audio" | "video"): FakeTrack {
  const handlers = new Map<string, Handler[]>();
  const track: FakeTrack = {
    kind,
    enabled: true,
    stopped: false,
    readyState: "live",
    stop: () => {
      track.stopped = true;
      track.readyState = "ended";
    },
    addEventListener: (name, fn) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    emit: (name) => {
      for (const fn of handlers.get(name) ?? []) fn();
    },
  };
  return track;
}

function fakeStream(kinds: ("audio" | "video")[]) {
  const tracks = kinds.map(fakeTrack);
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
  return { tracks, stream };
}

let granted: { tracks: FakeTrack[]; stream: MediaStream }[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;
/** What the next sync response carries back. Tests overwrite it. */
let serverSays: Record<string, unknown>;
/** Every engine a test started, so none is left polling into the next one. */
let started: MeetingClient[] = [];

function person(peerId: string, role: MeetingRole): RosterEntry {
  return {
    id: `p-${peerId}`,
    peerId,
    name: peerId,
    role,
    micOn: false,
    cameraOn: false,
    sharing: false,
    handRaised: false,
    lowData: false,
    quality: "good",
    admitted: true,
    sfuSessionId: null,
    joinedAt: new Date().toISOString(),
    userId: null,
  };
}

beforeEach(() => {
  granted = [];
  serverSays = { ok: true };
  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const kinds: ("audio" | "video")[] = [];
    if (constraints.audio) kinds.push("audio");
    if (constraints.video) kinds.push("video");
    const made = fakeStream(kinds);
    granted.push(made);
    return made.stream;
  });

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  /*
   * The long-poll is held open rather than answered at once. A fake that
   * returns immediately turns `listenLoop` into a hot loop that starves
   * everything else in the test, which is also roughly what it would do to a
   * real browser — so this is the honest fake as well as the useful one.
   * Everything else (a state push, with wait: false) answers straight away.
   */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const wait = typeof init?.body === "string" && init.body.includes('"wait":true');
      if (wait) await new Promise((r) => setTimeout(r, 30_000));
      return { ok: true, status: 200, json: async () => serverSays };
    }),
  );
});

afterEach(async () => {
  for (const engine of started) await engine.stop();
  started = [];
  vi.unstubAllGlobals();
});

function client(
  opts: {
    role?: MeetingRole;
    room?: { allowAttendeeMic: boolean; allowAttendeeCamera: boolean };
    lowData?: boolean;
  } = {},
) {
  const errors: string[] = [];
  const interruptions: string[] = [];
  const engine = new MeetingClient({
    code: "abcdef",
    peerId: "me",
    secret: "secret",
    cursor: 0,
    iceServers: [],
    lowData: opts.lowData ?? false,
    role: opts.role ?? "attendee",
    room: opts.room,
    events: {
      onError: (message) => errors.push(message),
      onMicInterrupted: (outcome) => interruptions.push(outcome),
    },
  });
  /*
   * Started, because the engine refuses to re-open a microphone for a call
   * that is not running — which is right, and which means a test of recovery
   * has to be a test of a running call.
   */
  engine.start();
  started.push(engine);
  return { engine, errors, interruptions };
}

const micTracks = () => granted.flatMap((g) => g.tracks).filter((t) => t.kind === "audio");

/**
 * Kill the microphone the engine is currently using, and wait for the verdict.
 *
 * Waiting on the REPORT rather than on a new track appearing, deliberately: a
 * stream is recorded by the fake the instant `getUserMedia` resolves, which is
 * before the engine has attached its listeners to the new track. A test that
 * raced ahead to that moment would emit "ended" into nothing and then wait for
 * a recovery that was never asked for.
 */
async function killMic(interruptions: string[]): Promise<void> {
  const before = interruptions.length;
  const live = micTracks().filter((t) => !t.stopped);
  (live[live.length - 1] ?? micTracks()[micTracks().length - 1]).emit("ended");
  await vi.waitFor(() => expect(interruptions.length).toBeGreaterThan(before));
}

/* ============================================================
 * Who may be heard
 * ========================================================== */

const LOCKED = { allowAttendeeMic: false, allowAttendeeCamera: false };

describe("a room locked down to its leaders", () => {
  it("never even asks an attendee for a microphone", async () => {
    /*
     * The device is not opened and then muted — it is not opened. A permission
     * dialog for a microphone that cannot be turned on is a dialog that can
     * only be answered wrongly, and on a phone it is the most alarming thing
     * on the screen.
     */
    const { engine, errors } = client({ role: "attendee", room: LOCKED });
    await engine.setMic(true);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(engine.currentState().micOn).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it("refuses the camera the same way", async () => {
    const { engine, errors } = client({ role: "attendee", room: LOCKED });
    await engine.setCamera(true);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(engine.currentState().cameraOn).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it("lets the host and the co-host straight through", async () => {
    for (const role of ["host", "cohost"] as const) {
      granted = [];
      getUserMedia.mockClear();
      const { engine, errors } = client({ role, room: LOCKED });
      await engine.setMic(true);
      expect(engine.currentState().micOn, role).toBe(true);
      expect(errors, role).toHaveLength(0);
    }
  });

  it("lets a speaker through, which is the point of the role", async () => {
    // A host hands one person the microphone without handing them the power
    // to end the meeting or remove anybody.
    const { engine, errors } = client({ role: "speaker", room: LOCKED });
    await engine.setMic(true);

    expect(engine.currentState().micOn).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("says nothing of the sort in an ordinary meeting", async () => {
    const { engine, errors } = client({ role: "attendee" });
    await engine.setMic(true);
    expect(engine.currentState().micOn).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("locks the microphone without locking the camera", async () => {
    const { engine } = client({
      role: "attendee",
      room: { allowAttendeeMic: false, allowAttendeeCamera: true },
    });
    expect(engine.currentState().rights).toEqual({ mic: false, camera: true });
  });

  it("takes the microphone away when a speaker is demoted mid-call", async () => {
    /*
     * Read off the roster rather than off the `control` signal that announces
     * it. A signal can be missed and is then missed for ever; the roster
     * arrives on every poll, so this repairs itself within seconds — and the
     * alternative is somebody live in a room that believes it has silenced
     * them, which is the worst outcome available.
     */
    const { engine } = client({ role: "speaker", room: LOCKED });
    await engine.setMic(true);
    expect(engine.currentState().micOn).toBe(true);

    serverSays = { ok: true, roster: [person("me", "attendee")] };
    // Any state push goes to the same endpoint and comes back with the roster.
    engine.setHandRaised(true);

    await vi.waitFor(() => {
      expect(engine.currentState().role).toBe("attendee");
      expect(engine.currentState().rights.mic).toBe(false);
      expect(engine.currentState().micOn).toBe(false);
    });
  });

  it("gives it back the moment a host makes somebody a speaker", async () => {
    const { engine } = client({ role: "attendee", room: LOCKED });
    expect(engine.currentState().rights.mic).toBe(false);

    serverSays = { ok: true, roster: [person("me", "speaker")] };
    engine.setHandRaised(true);

    await vi.waitFor(() => {
      expect(engine.currentState().rights.mic).toBe(true);
    });

    await engine.setMic(true);
    expect(engine.currentState().micOn).toBe(true);
  });
});

/* ============================================================
 * A microphone that dies mid-call
 * ========================================================== */

describe("a microphone that dies mid-call", () => {
  it("re-opens it and says so", async () => {
    const { engine, interruptions } = client();
    await engine.setMic(true);
    expect(micTracks()).toHaveLength(1);

    // What a headset being unplugged looks like from here.
    await killMic(interruptions);

    expect(micTracks()).toHaveLength(2);
    expect(interruptions).toEqual(["recovered"]);
    // And the person is still unmuted — recovery must not quietly mute them.
    expect(engine.currentState().micOn).toBe(true);
    expect(micTracks()[1].enabled).toBe(true);
  });

  it("watches the replacement too", async () => {
    const { engine, interruptions } = client();
    await engine.setMic(true);

    await killMic(interruptions);
    await killMic(interruptions);

    expect(micTracks()).toHaveLength(3);
    expect(interruptions).toEqual(["recovered", "recovered"]);
  });

  it("leaves a muted microphone alone", async () => {
    // Nothing to recover: they chose to be muted, and re-opening the device
    // behind their back would put the indicator light back on.
    const { engine, interruptions } = client();
    await engine.setMic(true);
    await engine.setMic(false);
    const before = micTracks().length;

    micTracks()[0].emit("ended");
    await Promise.resolve();
    await Promise.resolve();

    expect(micTracks()).toHaveLength(before);
    expect(interruptions).toHaveLength(0);
  });

  it("gives up eventually rather than retrying for the whole hour", async () => {
    const { engine, interruptions } = client();
    await engine.setMic(true);

    // A device that has genuinely gone — a headset carried out of the room.
    for (let i = 0; i < 12 && !interruptions.includes("lost"); i++) {
      await killMic(interruptions);
    }

    expect(interruptions).toContain("lost");
    // Bounded: it does not go on opening devices for the rest of the hour.
    expect(micTracks().length).toBeLessThanOrEqual(8);
    /*
     * And it turns the microphone OFF when it gives up.
     *
     * This used to assert the opposite, and the opposite was wrong. Leaving
     * `micOn` true with no working track on any sender meant every other
     * person in the room went on seeing a live microphone beside a name
     * nobody could hear, and the person themselves had a red "mute" button
     * implying they were being heard. Off is the honest state: nothing is
     * being sent, the button and the roster both say so, and pressing it
     * tries the device again.
     */
    expect(engine.currentState().micOn).toBe(false);
  });

  it("reports a device that cannot be re-opened at all", async () => {
    const { engine, interruptions } = client();
    await engine.setMic(true);

    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { name: "NotReadableError" }),
    );
    await killMic(interruptions);

    expect(interruptions).toEqual(["lost"]);
  });
});
