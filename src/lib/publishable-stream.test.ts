import { describe, expect, it } from "vitest";

/**
 * The rule behind the black remote tile.
 *
 * A peer's tracks live in one long-lived MediaStream that is mutated in place
 * — a track removed here, a new one added there, every time somebody restarts
 * ICE or turns a camera off and on. A `<video>` element holds `srcObject` by
 * reference, so the usual guard
 *
 *     if (el.srcObject !== stream) el.srcObject = stream;
 *
 * is false for ever after the first assignment. The element is never
 * re-pointed and Chrome goes on rendering the track that was removed: a tile
 * that is black while `getStats` reports 300 kilobits a second arriving.
 *
 * The fix is a copy keyed on the track ids. New object when the tracks change
 * so React and the video element both notice; the SAME object when they have
 * not, because copying on every publish means a new object several times a
 * second and a picture that blinks.
 *
 * `publishable` is a private method on the client, which needs a browser. The
 * rule it implements does not, so it is restated here and pinned. If this test
 * and that method ever disagree, the method is the one that is wrong.
 */

type Cache = { key: string; stream: FakeStream } | null;

/** Just enough MediaStream to have identity and a track list. */
class FakeStream {
  constructor(public tracks: { id: string }[]) {}
  getTracks() {
    return this.tracks;
  }
}

function publishable(current: FakeStream, cache: Cache): { key: string; stream: FakeStream } {
  const tracks = current.getTracks();
  const key = tracks
    .map((t) => t.id)
    .sort()
    .join("|");
  if (cache && cache.key === key) return cache;
  return { key, stream: new FakeStream(tracks) };
}

describe("publishable", () => {
  it("returns the same object while the tracks are unchanged", () => {
    const live = new FakeStream([{ id: "a" }, { id: "v1" }]);
    const first = publishable(live, null);
    const second = publishable(live, first);

    // Identity matters: a new object here is a re-render and a re-assigned
    // srcObject several times a second, which makes the picture blink.
    expect(second.stream).toBe(first.stream);
  });

  it("returns a NEW object when a track is swapped", () => {
    const live = new FakeStream([{ id: "a" }, { id: "v1" }]);
    const first = publishable(live, null);

    // What an ICE restart does: same stream object, different video track.
    live.tracks = [{ id: "a" }, { id: "v2" }];
    const second = publishable(live, first);

    // This is the whole bug. Without a new object the video element keeps
    // rendering v1, which has ended, and the tile is black for ever.
    expect(second.stream).not.toBe(first.stream);
    expect(second.stream.getTracks().map((t) => t.id)).toEqual(["a", "v2"]);
  });

  it("returns a new object when a track is added or removed", () => {
    const live = new FakeStream([{ id: "a" }]);
    const audioOnly = publishable(live, null);

    live.tracks = [{ id: "a" }, { id: "v1" }];
    const withVideo = publishable(live, audioOnly);
    expect(withVideo.stream).not.toBe(audioOnly.stream);

    live.tracks = [{ id: "a" }];
    const backToAudio = publishable(live, withVideo);
    expect(backToAudio.stream).not.toBe(withVideo.stream);
  });

  it("does not care what order the tracks are in", () => {
    const live = new FakeStream([{ id: "a" }, { id: "v1" }]);
    const first = publishable(live, null);

    // Removing and re-adding can reorder them. That is not a change.
    live.tracks = [{ id: "v1" }, { id: "a" }];
    expect(publishable(live, first).stream).toBe(first.stream);
  });
});
