/**
 * Who gets a nudge email today, and which one.
 *
 * Pure: no database, no server-only imports, so the decision can be unit-tested
 * directly instead of being inferred from what landed in somebody's inbox.
 *
 * This exists because the rules it replaces sent the wrong email forever. The
 * weekend reminder fired on `!lastAtt || lastAtt < lastSaturday`, and a church
 * that has never recorded attendance has `lastAtt === null` permanently — so
 * every Monday, for as long as the account existed, its owner was told
 * "you haven't recorded attendance for this past weekend yet". Nine of fourteen
 * churches were in exactly that state: signed up, added themselves as the only
 * member, never came back. The one message they received was a weekly reproach
 * for skipping a routine they had never begun.
 *
 * The same condition nagged any church that stopped recording, not only those
 * that never started. `lastAtt < lastSaturday` stays true for ever once a
 * church goes quiet, so a reminder meant for a single missed Sunday repeated
 * itself weekly until the account was deleted.
 */

import type { ChurchHealth } from "@/lib/health-rules";

export type ReminderKind = "inactive" | "weekend" | "login";

export type ReminderInput = {
  /** From `classifyHealth`. A church that never started is left alone. */
  health: ChurchHealth;
  /** Latest attendance session date, "YYYY-MM-DD", or null if never. */
  lastAtt: string | null;
  /** Latest giving date, "YYYY-MM-DD", or null. */
  lastGiv: string | null;
  /** When a member was last added. */
  lastMem: Date | null;
  /** When the owner's session was last seen. */
  lastLogin: Date | null;
  now: Date;
};

const DAY_MS = 86_400_000;

/**
 * How stale an attendance habit may be and still earn a weekend reminder.
 *
 * Three weeks covers a church that missed a Sunday, was away for a conference,
 * or had a fortnight of someone else doing the counting. Past that the silence
 * is not an oversight to correct with a reminder, it is a lapse that wants a
 * person — so the weekend email stops and the church surfaces on the activation
 * board instead.
 */
export const WEEKEND_LAPSE_GRACE_DAYS = 21;

function daysSince(then: number, now: Date): number {
  return (now.getTime() - then) / DAY_MS;
}

/** A date as "YYYY-MM-DD" in local time, matching how sessions are stored. */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The Saturday just gone, as "YYYY-MM-DD". Only meaningful on a Monday. */
export function lastSaturday(now: Date): string {
  const sat = new Date(now);
  sat.setDate(now.getDate() - 2);
  return isoDate(sat);
}

/**
 * Whole days between two calendar dates.
 *
 * An attendance session is a DATE, not an instant. Measuring it against a
 * timestamped `now` made the gap drift by the time of day — a service recorded
 * exactly three weeks ago read as 21.4 days and fell outside a 21-day window
 * depending on what time the cron happened to run. Comparing date to date makes
 * the boundary mean the same thing at any hour.
 */
function daysBetweenDates(fromIso: string, to: Date): number {
  return (Date.parse(isoDate(to)) - Date.parse(fromIso)) / DAY_MS;
}

/**
 * The single email this church should get today, or null for silence.
 *
 * Priority: a whole quiet week outranks a missed Sunday, which outranks a few
 * days without a login. At most one email per church per day, as before.
 */
export function shouldRemind(input: ReminderInput): ReminderKind | null {
  /*
   * A church that never started gets nothing from this ladder. Every message
   * here presumes a routine — recording last Sunday, returning after a quiet
   * week — and to somebody who has not begun, each one reads as a rebuke for
   * failing at something they were never shown how to do. Their first contact
   * belongs to the activation sequence, which is written for people at the
   * beginning rather than people who slipped.
   */
  if (input.health === "never_activated" || input.health === "suspended") {
    return null;
  }

  const { now } = input;

  const activityMs = Math.max(
    input.lastAtt ? Date.parse(input.lastAtt) : 0,
    input.lastGiv ? Date.parse(input.lastGiv) : 0,
    input.lastMem ? new Date(input.lastMem).getTime() : 0,
  );

  // A window, not a threshold: the reminder fires on one day only, so a church
  // that stays quiet is not told about it again tomorrow.
  if (activityMs > 0) {
    const quiet = daysSince(activityMs, now);
    if (quiet >= 7 && quiet < 8) return "inactive";
  }

  if (now.getDay() === 1 && input.lastAtt) {
    const lapsed = daysBetweenDates(input.lastAtt, now);
    /*
     * `lastAtt` must exist and be recent. Requiring it at all is what stops the
     * message reaching a church with no attendance history; requiring it to be
     * recent is what stops a single missed Sunday becoming a weekly habit of
     * its own.
     */
    if (input.lastAtt < lastSaturday(now) && lapsed <= WEEKEND_LAPSE_GRACE_DAYS) {
      return "weekend";
    }
  }

  if (input.lastLogin) {
    const since = daysSince(new Date(input.lastLogin).getTime(), now);
    if (since >= 3 && since < 4) return "login";
  }

  return null;
}
