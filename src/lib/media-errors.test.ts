import { afterEach, describe, expect, it, vi } from "vitest";
import { playWhenAllowed } from "@/lib/media-errors";

/**
 * Sound that the browser holds until a tap.
 *
 * On an iPhone that is not capturing — a listener who joined muted with the
 * camera off — every voice in a meeting is refused autoplay. The old handling
 * logged one line and stopped, on the belief that it "resolves itself on the
 * first click". It does not: a refused element stays paused for ever. These
 * pin the retry, and the signal the room uses to say "tap to turn the sound on".
 */

const refused = (name: string) => Promise.reject(new DOMException("refused", name));

/** Let the play() promise and its handlers settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeElement(...results: (() => Promise<void>)[]) {
  const play = vi.fn(() => (results.shift() ?? (() => Promise.resolve()))());
  return { el: { play } as unknown as HTMLMediaElement, play };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("playWhenAllowed", () => {
  it("plays, says nothing is held, and listens for nothing", async () => {
    const page = new EventTarget();
    const { el, play } = fakeElement(() => Promise.resolve());
    const held = vi.fn();

    playWhenAllowed(el, "test", held, page);
    await settle();
    page.dispatchEvent(new Event("pointerup"));
    await settle();

    expect(play).toHaveBeenCalledTimes(1);
    expect(held).toHaveBeenLastCalledWith(false);
  });

  it("plays again on the next tap when the browser wanted one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const page = new EventTarget();
    const { el, play } = fakeElement(() => refused("NotAllowedError"), () => Promise.resolve());
    const held = vi.fn();

    playWhenAllowed(el, "test", held, page);
    await settle();
    expect(held).toHaveBeenLastCalledWith(true);

    page.dispatchEvent(new Event("pointerup"));
    await settle();

    expect(play).toHaveBeenCalledTimes(2);
    expect(held).toHaveBeenLastCalledWith(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("takes a key press as permission too", async () => {
    const page = new EventTarget();
    const { el, play } = fakeElement(() => refused("NotAllowedError"), () => Promise.resolve());
    const held = vi.fn();

    playWhenAllowed(el, "test", held, page);
    await settle();
    page.dispatchEvent(new Event("keydown"));
    await settle();

    expect(play).toHaveBeenCalledTimes(2);
    expect(held).toHaveBeenLastCalledWith(false);
  });

  it("keeps listening when a tap is refused as well", async () => {
    // A touch fires more than one of these; one refusal must not leave
    // nobody listening for the next.
    const page = new EventTarget();
    const { el, play } = fakeElement(
      () => refused("NotAllowedError"),
      () => refused("NotAllowedError"),
      () => Promise.resolve(),
    );
    const held = vi.fn();

    playWhenAllowed(el, "test", held, page);
    await settle();
    page.dispatchEvent(new Event("pointerup"));
    await settle();
    expect(held).toHaveBeenLastCalledWith(true);

    page.dispatchEvent(new Event("touchend"));
    await settle();

    expect(play).toHaveBeenCalledTimes(3);
    expect(held).toHaveBeenLastCalledWith(false);
  });

  it("stops listening once it is cleaned up", async () => {
    const page = new EventTarget();
    const { el, play } = fakeElement(() => refused("NotAllowedError"));
    const held = vi.fn();

    const stop = playWhenAllowed(el, "test", held, page);
    await settle();
    stop();
    page.dispatchEvent(new Event("pointerup"));
    await settle();

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("ignores a play that a newer one superseded", async () => {
    const page = new EventTarget();
    const { el } = fakeElement(() => refused("AbortError"));
    const held = vi.fn();

    playWhenAllowed(el, "test", held, page);
    await settle();

    expect(held).not.toHaveBeenCalled();
  });

  it("reports a real failure instead of waiting for a tap that cannot help", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = new EventTarget();
    const { el } = fakeElement(() => refused("NotSupportedError"));
    const held = vi.fn();

    playWhenAllowed(el, "meeting audio", held, page);
    await settle();

    expect(held).not.toHaveBeenCalledWith(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("meeting audio");
  });
});
