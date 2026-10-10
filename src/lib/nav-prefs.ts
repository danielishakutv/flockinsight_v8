/**
 * "Quick access": the handful of places this person actually goes.
 *
 * Twenty-seven modules in seven groups is a well-organised menu and still a
 * menu you scroll. Nobody uses twenty-seven; a church secretary uses five, a
 * treasurer uses three, and they are not the same five. Surfacing them at the
 * top is the one change that shortens the common path without taking anything
 * away from anybody — the full menu is still underneath, in the same order,
 * every time.
 *
 * Two things feed it, and the order between them is the point:
 *
 *  1. **What they pinned.** Declared. Honoured immediately, exactly as given,
 *     and never reordered by a score.
 *  2. **Where they keep going.** Inferred, and therefore only ever allowed to
 *     fill the space the pins left. A guess must not be able to evict
 *     something a person actually asked for.
 *
 * Everything here is pure — no React, no DOM, no localStorage. The storage
 * keys are at the bottom and the reactive read is `useStoredValue` in
 * `lib/client-state.ts`; these are the rules, so they can be argued with in a
 * test rather than by clicking around for a fortnight.
 */

/** How many visits we remember per destination, and when the last one was. */
export type Visit = { n: number; last: number };
export type VisitLog = Record<string, Visit>;

export type QuickItem = {
  href: string;
  /** True when the person pinned it, false when we worked it out. */
  pinned: boolean;
};

/* ------------------------------------------------------------------ *
 * The numbers, and why each one is what it is
 * ------------------------------------------------------------------ */

/**
 * How fast a habit fades. A destination visited today counts for twice what
 * the same destination visited a fortnight ago counts for.
 *
 * Two weeks rather than two days because a church's rhythm is weekly. Giving
 * is opened on Sunday and Monday and not again; a half-life shorter than the
 * gap would drop it off the list every Wednesday and put it back every
 * weekend, and a shortcut row that rearranges itself midweek is worse than no
 * shortcut row, because the position is the whole value.
 */
export const HALF_LIFE_DAYS = 14;

/** Pins plus guesses. Six rows is a glance; ten is a second menu. */
export const QUICK_ACCESS_MAX = 6;

/**
 * A destination has to be visited twice before we will claim it is a habit.
 *
 * One visit is a look around. Promoting it would fill a brand-new church's
 * shortcut row with the four pages they happened to open while finding their
 * way, which is the opposite of a shortcut.
 */
export const MIN_VISITS = 2;

/**
 * And two of them have to qualify before the row appears at all.
 *
 * A heading with one thing under it is not a shortcut, it is furniture. The
 * row earns its place at the top of the menu or it does not appear; nothing in
 * between.
 */
export const MIN_AUTO_ITEMS = 2;

/**
 * Destinations we will never promote on our own.
 *
 * The dashboard is the first row of the menu, it is what the wordmark points
 * at, and it is where every sign-in lands — so it is by a wide margin the
 * most-visited page in the app, and it would permanently occupy a shortcut
 * slot to save nobody a single scroll. It can still be pinned: that is a
 * person saying they want it there, which is a different claim from us
 * noticing they go there.
 */
export const NEVER_AUTO: readonly string[] = ["/dashboard"];

/**
 * How many destinations the log keeps.
 *
 * Bounded because this is somebody's browser, not a warehouse, and because
 * modules get renamed — an unbounded log slowly fills with the addresses of
 * pages that no longer exist. Lowest score goes first, so trimming drops what
 * was already never going to be shown.
 */
export const LOG_MAX = 40;

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

/**
 * Which nav destination a path belongs to, or null for "none of them".
 *
 * Longest prefix wins, and the boundary is a slash — so /first-timers is
 * itself rather than a visit to a shorter entry that happens to share its
 * opening characters, and /members/abc123 counts as a visit to Members, which
 * is the honest reading: somebody looking at one member's record is using
 * Members.
 */
export function destinationFor(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  const matches = hrefs.filter(
    (href) => pathname === href || pathname.startsWith(href + "/"),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * One more visit to `href`, as of `now`.
 *
 * Returns a new log rather than mutating, so the caller can hand it straight
 * to a store without wondering whether anything else is holding the old one.
 */
export function recordVisit(log: VisitLog, href: string, now: number): VisitLog {
  const prev = log[href];
  const next: VisitLog = {
    ...log,
    [href]: { n: (prev?.n ?? 0) + 1, last: now },
  };
  return trimLog(next, now);
}

/** Keep the log bounded, dropping the least likely to ever be shown. */
export function trimLog(log: VisitLog, now: number): VisitLog {
  const hrefs = Object.keys(log);
  if (hrefs.length <= LOG_MAX) return log;
  const keep = hrefs
    .sort((a, b) => score(log[b], now) - score(log[a], now))
    .slice(0, LOG_MAX);
  const out: VisitLog = {};
  for (const href of keep) out[href] = log[href];
  return out;
}

/**
 * Forget a destination entirely — what "stop suggesting this" has to mean.
 *
 * Removing the row without clearing the count would put it back within a week,
 * and an app that argues with somebody about their own menu has stopped being
 * theirs.
 */
export function forget(log: VisitLog, href: string): VisitLog {
  if (!(href in log)) return log;
  const out = { ...log };
  delete out[href];
  return out;
}

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

/**
 * Frequency, discounted by how long ago.
 *
 * Multiplicative rather than a weighted sum of two normalised terms, because
 * the behaviour that matters falls out of it for free: fifty visits three
 * months ago lose to two visits yesterday, so somebody whose job changed gets
 * a shortcut row that changed with them.
 */
export function score(visit: Visit | undefined, now: number): number {
  if (!visit) return 0;
  const days = Math.max(0, (now - visit.last) / DAY_MS);
  return visit.n * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/**
 * What to measure "how long ago" from.
 *
 * The clock, if you have one — but the point of this function is that the
 * ORDER does not depend on having one. Expand the score and the reference
 * point factors out:
 *
 *     n * 0.5^((ref - last)/H)  ==  n * 0.5^(-last/H) * 0.5^(ref/H)
 *
 * The right-hand term is the same for every row, so moving `ref` scales all of
 * them by one constant and cannot reorder any of them. Which is what makes the
 * newest visit in the log a perfectly good reference — and lets the hook that
 * ranks these rows be a pure function of what is stored, instead of calling
 * `Date.now()` in the middle of a render and getting a different answer every
 * time React happens to re-run it.
 *
 * Zero for an empty log; nothing is being ranked anyway.
 */
export function referencePoint(log: VisitLog): number {
  let newest = 0;
  for (const href of Object.keys(log)) {
    if (log[href].last > newest) newest = log[href].last;
  }
  return newest;
}

/**
 * The rows to show, pinned first.
 *
 * `hrefs` is what this person is actually allowed to see — passed in rather
 * than read, because the log outlives a permission being taken away, and a
 * shortcut to a page that now refuses them is a worse outcome than no
 * shortcut. The same goes for a module that moved behind a plan they let
 * lapse.
 */
export function rankQuickAccess({
  log,
  pins,
  hrefs,
  now,
  max = QUICK_ACCESS_MAX,
}: {
  log: VisitLog;
  pins: readonly string[];
  hrefs: readonly string[];
  now: number;
  max?: number;
}): QuickItem[] {
  const allowed = new Set(hrefs);

  // Declared, in the order they pinned them. Not scored, not sorted.
  const pinned = pins
    .filter((href) => allowed.has(href))
    .slice(0, max)
    .map((href) => ({ href, pinned: true }));

  const room = max - pinned.length;
  if (room <= 0) return pinned;

  const auto = Object.keys(log)
    .filter(
      (href) =>
        allowed.has(href) &&
        !pins.includes(href) &&
        !NEVER_AUTO.includes(href) &&
        log[href].n >= MIN_VISITS,
    )
    .sort(
      (a, b) => score(log[b], now) - score(log[a], now) || a.localeCompare(b),
    );

  /*
   * All or nothing on the guesses.
   *
   * Below the threshold the guesses are suppressed rather than shown short —
   * but only the GUESSES. A pin is somebody's instruction and does not wait
   * for a quorum.
   */
  const keep = auto.length >= MIN_AUTO_ITEMS ? auto.slice(0, room) : [];
  return [...pinned, ...keep.map((href) => ({ href, pinned: false }))];
}

/** Pinning and unpinning, keeping the order they were added in. */
export function togglePin(pins: readonly string[], href: string): string[] {
  return pins.includes(href)
    ? pins.filter((h) => h !== href)
    : [...pins, href].slice(0, QUICK_ACCESS_MAX);
}

/* ------------------------------------------------------------------ *
 * Persistence
 *
 * Only the keys. Reading goes through `useStoredValue`, which returns null
 * during SSR and hydration so the markup agrees with itself, and updates every
 * tab at once.
 *
 * The rail is NOT here: its width changes the page layout, so it is a cookie
 * the server reads before the first paint. A localStorage rail means every
 * load draws the wide sidebar and then snaps, reflowing the page under
 * somebody's cursor. See `lib/nav-rail.ts`.
 * ------------------------------------------------------------------ */

export const VISITS_KEY = "fi-nav-visits";
export const PINS_KEY = "fi-nav-pins";
export const CLOSED_GROUPS_KEY = "fi-nav-closed";
/**
 * Whether the groups follow the page (`focus`) or stay as they were left
 * (`manual`). Separate from the closed list on purpose: switching to `focus`
 * and back has to give somebody the menu they had, not a reset one.
 */
export const GROUP_MODE_KEY = "fi-nav-sections";
