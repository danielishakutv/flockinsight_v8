"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useStoredValue, writeStoredValue } from "@/lib/client-state";
import {
  TIP_STORAGE_KEY,
  parseTipState,
  serialiseTipState,
  type TipState,
} from "@/lib/shortcut-tips";

/**
 * The tip state, in this browser and nowhere else.
 *
 * No database column and no server round trip, on purpose. "Have I been shown
 * the ⌘K tip" is a fact about a keyboard, not about a person — the same church
 * secretary on the office desktop and on her phone wants different answers,
 * and the phone wants none at all. It also means this feature adds nothing to
 * any query on any page.
 *
 * Built on `useStoredValue`, so a change in one tab reaches the other, and so
 * a browser with storage blocked reads `null`, shows no tip, and throws
 * nothing in the app shell.
 *
 * `update` takes a FUNCTION rather than a value, which matters for more than
 * tidiness. It re-reads storage at the moment of writing, so:
 *
 *  - a write from a timer four seconds old cannot put back a stale copy of
 *    everything else in the blob — which is exactly what happens when "the
 *    tip appeared" lands after "no more tips" was pressed in another tab;
 *  - nothing needs to hold the current state in a ref to write it later, and
 *    a ref written during render is both a lint error here and a genuine
 *    hazard under concurrent rendering.
 *
 * It returns the state it wrote, because the caller usually needs to act on
 * it — counting a visit and then deciding what to show is one thought.
 */
export function useTipState(): {
  state: TipState;
  /** What is in storage right now, for a handler that must not use a closure. */
  read: () => TipState;
  update: (fn: (s: TipState) => TipState) => TipState;
} {
  const raw = useStoredValue(TIP_STORAGE_KEY);
  const state = parseTipState(raw);

  const read = useCallback((): TipState => {
    try {
      return parseTipState(localStorage.getItem(TIP_STORAGE_KEY));
    } catch {
      // Private mode, or storage blocked. A fresh state means the rules see
      // zero visits, so nothing is ever shown — which is the right answer
      // when we cannot remember having shown it.
      return parseTipState(null);
    }
  }, []);

  const update = useCallback((fn: (s: TipState) => TipState): TipState => {
    // Read through, not from the render's closure.
    let current: TipState;
    try {
      current = parseTipState(localStorage.getItem(TIP_STORAGE_KEY));
    } catch {
      current = parseTipState(null);
    }
    const next = fn(current);
    // `markVisit` and friends return the same object when nothing changed, so
    // this is no write at all on most navigations.
    if (next !== current) {
      writeStoredValue(TIP_STORAGE_KEY, serialiseTipState(next));
    }
    return next;
  }, []);

  return { state, read, update };
}

/* ------------------------------------------------------------------ *
 * Is there a keyboard?
 * ------------------------------------------------------------------ */

const KEYBOARD_QUERY = "(hover: hover) and (pointer: fine)";

function keyboardMatches(): boolean {
  try {
    return window.matchMedia(KEYBOARD_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Subscribed rather than read once, because the answer genuinely changes: an
 * iPad in a keyboard case is a touch device until the case is attached.
 */
function subscribeToKeyboard(onChange: () => void) {
  let mq: MediaQueryList;
  try {
    mq = window.matchMedia(KEYBOARD_QUERY);
  } catch {
    return () => {};
  }
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Has this device got a real keyboard?
 *
 * `(hover: hover) and (pointer: fine)` is the honest question. "Is it a phone"
 * cannot be asked directly — every way of guessing it from the user agent is
 * wrong about something, and a tablet with a keyboard case is precisely the
 * device that gets guessed wrong. A mouse and a hover state is the nearest
 * thing the platform will tell us to "there are keys here".
 *
 * `useSyncExternalStore` rather than an effect, following `useMounted` in
 * `lib/client-state.ts`: it returns the server answer during SSR and
 * hydration, then the real one, in one render fewer than the mounted-flag
 * dance. The server answer is `false`, which is the right default — a tip that
 * appears and then vanishes is worse than one that appears a moment late.
 */
export function useHasKeyboard(): boolean {
  return useSyncExternalStore(subscribeToKeyboard, keyboardMatches, () => false);
}
