/**
 * Starting and stopping media, with the refusals told apart.
 *
 * `el.play()` rejects for several unrelated reasons and these call sites used to
 * answer all of them with `.catch(() => {})`. That is the shape of bug that cost
 * a full day on "no video in meetings": five separate causes stacked, and the
 * one place that knew something had gone wrong threw the reason away.
 *
 * Blanket logging is not the fix either. `AbortError` arrives every time a tile
 * re-renders or swaps track, many times a minute, and a console full of it is
 * read exactly as attentively as a silent one.
 *
 * So each refusal is classified:
 *
 *   AbortError       a newer load or a pause() superseded this play(). Routine
 *                    and self-correcting — the newer call is the one that
 *                    matters. Ignored on purpose.
 *   NotAllowedError  the browser will not autoplay before the viewer has
 *                    interacted with the page. Expected, and it resolves itself
 *                    on their first click, but it is reported because it is the
 *                    difference between "the stream is broken" and "this
 *                    browser is waiting for a tap".
 *   anything else    a real failure — an undecodable stream, an unsupported
 *                    codec, a src that went away. Always reported.
 */

/** A newer play()/load() superseded this one. Routine; the newer call wins. */
const SUPERSEDED = "AbortError";

/** Autoplay refused pending a user gesture. */
const NEEDS_GESTURE = "NotAllowedError";

function nameOf(e: unknown): string {
  return e instanceof DOMException || e instanceof Error ? e.name : "";
}

/**
 * Play `el`, reporting anything that is not an ordinary browser refusal.
 *
 * `where` names the call site ("meeting tile", "livestream player") so a report
 * says which surface failed — there are several video elements on screen and
 * "play failed" on its own does not say which one.
 */
export function playMedia(
  el: HTMLMediaElement | null | undefined,
  where: string,
): void {
  if (!el) return;
  void el.play().catch((e: unknown) => {
    const name = nameOf(e);
    if (name === SUPERSEDED) return;
    if (name === NEEDS_GESTURE) {
      console.info(
        `${where}: the browser is holding playback until the viewer interacts ` +
          `with the page. Not a stream failure.`,
      );
      return;
    }
    console.error(`${where}: playback failed`, e);
  });
}

/**
 * Close an AudioContext, reporting anything beyond "it was already closed".
 *
 * Closing twice is normal in a React cleanup — an effect can tear down after
 * something else has already closed it — and that case alone is ignored.
 */
export function closeAudioContext(
  ctx: AudioContext | null | undefined,
  where: string,
): void {
  if (!ctx) return;
  if (ctx.state === "closed") return;
  void ctx.close().catch((e: unknown) => {
    // Raced with another close(). Harmless: the context is shut either way.
    if (nameOf(e) === "InvalidStateError") return;
    console.error(`${where}: could not close the audio context`, e);
  });
}
