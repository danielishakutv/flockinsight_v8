/**
 * The occasional "you could have pressed a key for that".
 *
 * Pure decision logic — no React, no DOM, no storage — because the whole value
 * of this feature is in when it DOESN'T appear, and that is a thing worth
 * testing rather than eyeballing.
 *
 * The idea in one line: teach one shortcut, at the moment it would have helped,
 * and never mention it again once the person has used it.
 *
 * That last part is what keeps it from becoming the thing everybody closes
 * without reading. A tip is not a notice to be dismissed a fixed number of
 * times; it is a question — "do you know this one yet?" — and using the key is
 * the answer. The app stops asking. A church secretary who learns three
 * shortcuts in her first month sees three tips, then silence, for ever.
 *
 * Six rules, in the order they are checked:
 *
 *  1. No keyboard, no tips. Most of this congregation is on a phone, and
 *     "press G then M" on a touchscreen is pure noise.
 *  2. Turned off, or all six already shown — never again.
 *  3. Not in the first few visits. Somebody still working out where Members
 *     is does not need a second syllabus.
 *  4. One at a time, and not for another two days. Measured in days because
 *     the thing being taught is a habit.
 *  5. Only something they can use, and have not already learned.
 *  6. Prefer the shortcut for the page they are standing on. They walked here
 *     by hand; this is the moment the key makes sense.
 */
import type { Shortcut } from "@/lib/shortcuts";

/** What we remember about somebody, kept in their own browser and nowhere else. */
export type TipState = {
  /** Shortcut ids they have actually pressed. These never get taught again. */
  learned: readonly string[];
  /** Tips shown, whether or not they were read. */
  shown: readonly string[];
  /** When the last tip appeared, epoch ms. */
  lastShownAt: number | null;
  /** How many pages they have opened. Rule 3. */
  visits: number;
  /** They pressed "don't show me tips". */
  off: boolean;
};

export const EMPTY_TIP_STATE: TipState = {
  learned: [],
  shown: [],
  lastShownAt: null,
  visits: 0,
  off: false,
};

/** One localStorage key, one JSON blob. */
export const TIP_STORAGE_KEY = "fi_shortcut_tips";

/**
 * Six, then it stops for good.
 *
 * Not because six is a magic number, but because a feature that can nag
 * indefinitely will eventually nag somebody who has been using the app for
 * three years. After six, `/help/keyboard-shortcuts` and the `?` sheet are
 * where shortcuts live, and both are there whenever somebody goes looking.
 */
export const MAX_TIPS = 6;

/** Rule 3: pages opened before the first tip. */
export const MIN_VISITS = 8;

/** Rule 4: two days between tips. */
export const TIP_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Storage, as plain functions
 * ------------------------------------------------------------------ */

/**
 * Parse whatever is in storage, trusting none of it.
 *
 * This blob is in the user's own browser, so it can be edited, truncated by a
 * full disk, or left over from an older shape of this type. Anything
 * unreadable becomes a fresh state: the worst case is somebody is taught a
 * shortcut they already knew, which is a far better failure than a crash in
 * the app shell on every page.
 */
export function parseTipState(raw: string | null): TipState {
  if (!raw) return EMPTY_TIP_STATE;
  try {
    const v = JSON.parse(raw) as Partial<TipState> | null;
    if (!v || typeof v !== "object") return EMPTY_TIP_STATE;
    return {
      learned: strings(v.learned),
      shown: strings(v.shown),
      lastShownAt:
        typeof v.lastShownAt === "number" && Number.isFinite(v.lastShownAt)
          ? v.lastShownAt
          : null,
      visits:
        typeof v.visits === "number" && Number.isFinite(v.visits) && v.visits > 0
          ? Math.floor(v.visits)
          : 0,
      off: v.off === true,
    };
  } catch {
    return EMPTY_TIP_STATE;
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function serialiseTipState(s: TipState): string {
  return JSON.stringify(s);
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

export type TipContext = {
  /** The page they are on, so the tip can be about it. */
  pathname: string;
  state: TipState;
  now: number;
  /** Already filtered by permission and plan — see `availableShortcuts`. */
  available: readonly Shortcut[];
  /** False on a touch-only device. Rule 1. */
  hasKeyboard: boolean;
};

/** The shortcut to teach right now, or `null` — which is the usual answer. */
export function chooseTip(ctx: TipContext): Shortcut | null {
  const { state, now, hasKeyboard } = ctx;

  if (!hasKeyboard) return null;
  if (state.off) return null;
  if (state.shown.length >= MAX_TIPS) return null;
  if (state.visits < MIN_VISITS) return null;
  if (state.lastShownAt !== null && now - state.lastShownAt < TIP_COOLDOWN_MS) {
    return null;
  }

  const teachable = ctx.available.filter(
    (s) =>
      /*
       * Escape is not worth a tip — anyone who has used a computer closes a
       * dialog with it already, and spending one of six on it would be a waste
       * of the only attention this feature gets.
       */
      s.id !== "close" &&
      !state.learned.includes(s.id) &&
      !state.shown.includes(s.id),
  );
  if (teachable.length === 0) return null;

  /*
   * The palette first, before anything about the current page.
   *
   * ⌘K is the only shortcut worth knowing on its own: it reaches every module,
   * including the fifteen with no key of their own, so somebody who learns
   * exactly one shortcut and ignores the rest still has the whole app a
   * keystroke away.
   *
   * It goes first because the alternative was measurably worse. Checking the
   * current page first — which is what this did at first, and what the test
   * caught — meant that almost everybody's FIRST tip was "press G then D to
   * reach the dashboard", because the dashboard is where signing in lands you.
   * A tip teaching the key for the page you are already on, and which you get
   * to by default, is the worst possible introduction to the idea.
   */
  const palette = teachable.find((s) => s.id === "palette");
  if (palette) return palette;

  /*
   * Then rule 6, which is the reason any of this is interesting: the shortcut
   * for where they already are.
   *
   * They clicked three times through the menu to reach Members. "Press G then
   * M" lands differently standing on that page than it would anywhere else,
   * because the thing it saves is the thing they just did by hand.
   */
  const here = teachable.find((s) => s.href && samePage(s.href, ctx.pathname));
  if (here) return here;

  // Otherwise registry order, which runs find → go → do.
  return teachable[0] ?? null;
}

/** `/members?new=1` and `/members/abc123` are both the Members page. */
export function samePage(href: string, pathname: string): boolean {
  const path = href.split("?")[0];
  return pathname === path || pathname.startsWith(path + "/");
}

/* ------------------------------------------------------------------ *
 * Recording what happened
 * ------------------------------------------------------------------ */

/** They used a shortcut. Stop teaching that one, for good. */
export function markLearned(state: TipState, id: string): TipState {
  if (state.learned.includes(id)) return state;
  return { ...state, learned: [...state.learned, id] };
}

/** A tip was put on screen. Starts the two-day clock. */
export function markShown(state: TipState, id: string, now: number): TipState {
  if (state.shown.includes(id)) return { ...state, lastShownAt: now };
  return { ...state, shown: [...state.shown, id], lastShownAt: now };
}

/** Another page opened. Rule 3 counts these. */
export function markVisit(state: TipState): TipState {
  // Stops counting well past the threshold: the number is only ever compared
  // against MIN_VISITS, and a counter that climbs for years is just a bigger
  // number in somebody's localStorage.
  if (state.visits > MIN_VISITS) return state;
  return { ...state, visits: state.visits + 1 };
}

/** "Don't show me tips." Honoured permanently, and reversible from Settings. */
export function turnTipsOff(state: TipState): TipState {
  return { ...state, off: true };
}

export function turnTipsOn(state: TipState): TipState {
  return { ...state, off: false };
}
