import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingClient } from "@/lib/meeting-client";

/**
 * What it means for a meeting to be over.
 *
 * Written after a real bug: the host pressed "End for everyone", every other
 * person got a screen saying the meeting had ended — and the call kept running
 * behind it. The mesh is peer-to-peer, so stopping the signalling loop does not
 * stop the media: the connections were still open, the audio was still flowing
 * between whoever was left, and every camera light was still on above a notice
 * that said the meeting was finished.
 *
 * So these tests are about the devices, not the screen. An ending that does not
 * release the camera is not an ending, however it reads.
 */

type FakeTrack = {
  kind: "audio" | "video";
  enabled: boolean;
  stopped: boolean;
  stop: () => void;
  addEventListener: () => void;
};

function fakeTrack(kind: "audio" | "video"): FakeTrack {
  const track: FakeTrack = {
    kind,
    enabled: true,
    stopped: false,
    stop: () => {
      track.stopped = true;
    },
    addEventListener: () => {},
  };
  return track;
}

/** Just enough of a MediaStream for the engine to hold and let go of. */
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

beforeEach(() => {
  granted = [];
  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const kinds: ("audio" | "video")[] = [];
    if (constraints.audio) kinds.push("audio");
    if (constraints.video) kinds.push("video");
    const made = fakeStream(kinds);
    granted.push(made);
    return made.stream;
  });

  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  // Every state push goes out over fetch. The engine must not depend on one
  // landing to let go of a device: the network is exactly what has usually
  // gone wrong by the time a call is ending.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function client(opts: { lowData?: boolean } = {}) {
  const ended: string[] = [];
  const errors: string[] = [];
  const engine = new MeetingClient({
    code: "abcdef",
    peerId: "peer-1",
    secret: "secret",
    cursor: 0,
    iceServers: [],
    lowData: opts.lowData ?? false,
    events: {
      onEnded: (reason) => ended.push(reason),
      onError: (message) => errors.push(message),
    },
  });
  return { engine, ended, errors };
}

/** Every track the engine has been handed, across both devices. */
const allTracks = () => granted.flatMap((g) => g.tracks);

describe("an ending releases the devices", () => {
  it("stops the microphone and the camera", async () => {
    const { engine } = client();
    await engine.setMic(true);
    await engine.setCamera(true);
    expect(allTracks()).toHaveLength(2);
    expect(allTracks().every((t) => t.stopped)).toBe(false);

    engine.endLocally("You left the meeting.");
    await vi.waitFor(() => {
      expect(allTracks().every((t) => t.stopped)).toBe(true);
    });
  });

  it("stops them for somebody who was alone in the room", async () => {
    /*
     * The regression that put the light on. `stop()` used to return early when
     * nothing was running and there were no peers — which is precisely the
     * state of one person in a room — so the devices were never released and the
     * camera light stayed on after they had left.
     */
    const { engine } = client();
    await engine.setMic(true);
    await engine.setCamera(true);

    await engine.stop();
    expect(allTracks().every((t) => t.stopped)).toBe(true);
  });

  it("says why once, however many times the news arrives", async () => {
    const { engine, ended } = client();
    await engine.setMic(true);

    engine.endLocally("You ended the meeting for everyone.");
    // The host's own button and the poll that follows it are two routes to the
    // same conclusion. The person must not be told the second one.
    engine.endLocally("This meeting has ended.");

    expect(ended).toEqual(["You ended the meeting for everyone."]);
    expect(engine.finished).toBe(true);
    await vi.waitFor(() => {
      expect(allTracks().every((t) => t.stopped)).toBe(true);
    });
  });

  it("turning the camera off releases it rather than muting it", async () => {
    // A disabled track is still a live track, and a live video track is a
    // camera light — which people rightly read as still being watched.
    const { engine } = client();
    await engine.setCamera(true);
    const camera = allTracks().filter((t) => t.kind === "video");
    expect(camera).toHaveLength(1);

    await engine.setCamera(false);
    expect(camera[0].stopped).toBe(true);
  });
});

describe("Data Saver never asks for a camera", () => {
  it("does not open one, even when something asks it to", async () => {
    /*
     * The whole point of the mode. Somebody on a metered connection who chose
     * voices-only must never see a camera permission dialog, and must never
     * have a camera held open on their behalf — the light is the proof, and it
     * is the thing they notice.
     */
    const { engine, errors } = client({ lowData: true });
    await engine.setMic(true);
    await engine.setCamera(true);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(engine.currentState().cameraOn).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it("releases the camera when Data Saver is switched on mid-call", async () => {
    const { engine } = client();
    await engine.setCamera(true);
    const camera = allTracks().filter((t) => t.kind === "video");

    await engine.setLowData(true);
    expect(camera[0].stopped).toBe(true);
    expect(engine.currentState().cameraOn).toBe(false);
  });
});
