/**
 * When to ask someone to install the app.
 *
 * An install prompt is the easiest thing in a product to get wrong: ask on
 * first paint and it reads as a pop-up ad for software the person is already
 * using; ask once and never again and almost nobody installs, because the first
 * time you ask is the time they know least about whether they want it.
 *
 * So: never on a first visit, never straight away, and after a "no" the gap
 * before asking again grows. Three refusals is an answer, and the gap becomes
 * long enough to be effectively a stop — but a quiet line on the dashboard
 * stays, so installing is always one tap away without anything interrupting.
 *
 * Pure functions with the clock passed in, so the cadence can be tested
 * without waiting two months.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long to wait after each refusal, in days.
 *
 * Grows steeply on purpose. The last value repeats for every refusal after
 * it — someone who has said no four times is not going to be won round by a
 * fifth banner.
 */
export const SNOOZE_DAYS = [7, 30, 90] as const;

/** Nothing is asked until someone has actually used the app a little. */
export const MIN_VISITS = 2;

/** And not the moment a page loads, which reads as a pop-up. */
export const QUIET_MS = 25_000;

export type InstallState = {
  /** How many times the prompt has been dismissed. */
  dismissals: number;
  /** When it was last dismissed, ms since epoch. 0 = never. */
  lastDismissedAt: number;
  /** How many separate visits this person has made. */
  visits: number;
  /** Set once they install. We never ask again. */
  installed: boolean;
};

export const EMPTY_STATE: InstallState = {
  dismissals: 0,
  lastDismissedAt: 0,
  visits: 0,
  installed: false,
};

/** Read a stored state without trusting its shape — it is user-editable. */
export function parseState(raw: string | null): InstallState {
  if (!raw) return EMPTY_STATE;
  try {
    const v = JSON.parse(raw) as Partial<InstallState>;
    return {
      dismissals: clampInt(v.dismissals, 0),
      lastDismissedAt: clampInt(v.lastDismissedAt, 0),
      visits: clampInt(v.visits, 0),
      installed: v.installed === true,
    };
  } catch {
    // Corrupt or hand-edited: start over rather than crash the dashboard.
    return EMPTY_STATE;
  }
}

function clampInt(v: unknown, min: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : min;
  return n < min ? min : n;
}

/** The soonest we may ask again after the dismissals recorded so far. */
export function nextAskAt(state: InstallState): number {
  if (state.dismissals === 0) return 0;
  const days =
    SNOOZE_DAYS[Math.min(state.dismissals, SNOOZE_DAYS.length) - 1];
  return state.lastDismissedAt + days * DAY;
}

/**
 * Should the prompt appear at all?
 *
 * Separate from *when* within a session — that is the quiet delay — so the
 * decision can be tested on its own.
 */
export function shouldAskToInstall(
  state: InstallState,
  now: number,
): boolean {
  if (state.installed) return false;
  if (state.visits < MIN_VISITS) return false;
  return now >= nextAskAt(state);
}

/** Record a refusal, lengthening the gap before the next one. */
export function recordDismissal(
  state: InstallState,
  now: number,
): InstallState {
  return { ...state, dismissals: state.dismissals + 1, lastDismissedAt: now };
}

/** Record a successful install. Nothing asks again after this. */
export function recordInstalled(state: InstallState): InstallState {
  return { ...state, installed: true };
}

/** Count this visit. */
export function recordVisit(state: InstallState): InstallState {
  return { ...state, visits: state.visits + 1 };
}

/**
 * In plain words, for the dashboard notice.
 *
 * iOS has no install API at all — Safari never fires `beforeinstallprompt` —
 * so on an iPhone the only thing we can do is tell someone where the button
 * is. Getting this wrong means an "Install" button that does nothing, which is
 * worse than no button.
 */
export type InstallRoute = "prompt" | "ios" | "unsupported";

export function installRoute(opts: {
  hasDeferredPrompt: boolean;
  isIOS: boolean;
}): InstallRoute {
  if (opts.hasDeferredPrompt) return "prompt";
  if (opts.isIOS) return "ios";
  return "unsupported";
}
