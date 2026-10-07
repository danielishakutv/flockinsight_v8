"use client";

/**
 * "You just did that the long way round."
 *
 * A page telling the tip system that somebody has performed, by hand, a thing
 * that has a shortcut — clicked **Add member** instead of pressing `n m`.
 *
 * That is the best moment in the whole app to teach a key, because the person
 * has this second demonstrated what the key is for. A tip offered on page load
 * is a guess about what might be useful; this one is a statement about what
 * just happened.
 *
 * An event rather than a prop or a context, for one reason: the buttons that
 * would report this are scattered through twenty modules, and threading a
 * callback from the app shell down to each of them would put this feature's
 * name in twenty component signatures. A module-level `teach()` call is one
 * line at the call site and nothing at all in the types above it.
 *
 * Every rule still applies. `chooseTip` is what decides, and it says no far
 * more often than yes — if they have used the key, or turned tips off, or seen
 * one yesterday, nothing appears. This only moves which shortcut is at the
 * front of the queue.
 */

export const TEACH_EVENT = "fi:did-manually";

/**
 * Report that a shortcut's job was just done by hand.
 *
 * Takes a shortcut id from `lib/shortcuts.ts`. An id that does not exist, or
 * one the person cannot use, means nothing happens — so a call site left
 * behind by a renamed shortcut goes quiet rather than wrong.
 *
 * Safe to call during a click handler, on the server, or in a test: without a
 * window there is nobody to tell.
 */
export function teach(shortcutId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<string>(TEACH_EVENT, { detail: shortcutId }),
  );
}
