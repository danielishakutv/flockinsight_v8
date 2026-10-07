"use client";

import { useSyncExternalStore } from "react";

/**
 * Is this a Mac, for the sake of printing ⌘ instead of Ctrl?
 *
 * The one piece of platform-sniffing this app does, and it earns its place:
 * telling a Mac user to press Ctrl+K is telling them to press a key that does
 * nothing. Nothing else branches on the answer.
 *
 * `navigator.platform` is deprecated but still the most reliable signal, so it
 * is tried first and the user-agent string is the fallback. Guessing wrong
 * costs one wrong glyph in a cheat sheet, which is why this is allowed to be a
 * guess at all.
 *
 * `useSyncExternalStore` with a `false` server snapshot, following `useMounted`
 * in `lib/client-state.ts` — so the markup the server sent and the markup
 * React hydrates agree, and the glyph corrects itself a render later rather
 * than logging a hydration mismatch.
 */
const noSubscribe = () => () => {};

function detect(): boolean {
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform =
      nav.userAgentData?.platform || navigator.platform || navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(platform);
  } catch {
    return false;
  }
}

export function useIsMac(): boolean {
  return useSyncExternalStore(noSubscribe, detect, () => false);
}
