import { isLeapYear, isYearUnknown } from "@/lib/birthday";
import { isValidTimeZone } from "@/lib/country-profile";

/**
 * Which days are "today", "tomorrow" and the fortnight after, for a church —
 * and which stored dates are celebrated on each of them.
 *
 * Pure (no database, no server-only), so the cron, the settings preview, the
 * /celebrations page and the dashboard widgets all answer with the same rule,
 * and the rule can be tested with a frozen clock.
 *
 * TWO THINGS THIS FIXES.
 *
 * "Today" was the SERVER's today. Every preview built its window with
 * `new Date()` and `getDate()` on a UTC box, while the cron that actually sends
 * asked the church's own timezone — so between midnight and 3am in Nairobi the
 * dashboard listed yesterday's celebrants as "Today", and in the Americas
 * tomorrow's showed up in the evening. The preview and the send disagreed about
 * who was being greeted. Everything here starts from the church's own calendar
 * date and then steps in UTC arithmetic, so the server's zone drops out.
 *
 * 29 February was nobody's birthday three years in four. Birthdays are matched
 * on MM-DD, and in 2026 no day is "02-29" — so a member born on a leap day was
 * never greeted and never listed. They are now celebrated on 28 February in a
 * year that has no 29th, which is the common convention, and in a leap year
 * on the day itself.
 */

/** The zone a display falls back to when a church's stored one is unusable. */
export const DISPLAY_FALLBACK_ZONE = "Africa/Lagos";

/**
 * A timezone to DISPLAY with. A preview must still render for a church whose
 * stored zone is broken, so it falls back; the cron, which must not send on a
 * guess, checks `isValidTimeZone` itself and skips the church instead.
 */
export function displayZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DISPLAY_FALLBACK_ZONE;
}

/** The church's calendar date ("YYYY-MM-DD") and minutes past its midnight. */
export function localNow(
  tz: string,
  at: Date = new Date(),
): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

/**
 * The MM-DD keys celebrated on the day `mmdd` of `year`.
 *
 * 28 February of a year with no 29th also claims "02-29". Everything else is
 * only itself.
 */
export function celebrationKeysFor(mmdd: string, year: number): string[] {
  return mmdd === "02-28" && !isLeapYear(year) ? ["02-28", "02-29"] : [mmdd];
}

export type WindowDay = {
  /** "MM-DD" */
  key: string;
  /** 0 is today where the church is. */
  offset: number;
  year: number;
  /** 0–11 */
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
};

/** The next `days` days, starting with today in `tz`. */
export function celebrationWindow(
  tz: string,
  days: number,
  at: Date = new Date(),
): WindowDay[] {
  const [y, m, d] = localNow(tz, at).date.split("-").map(Number);
  const out: WindowDay[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push({
      key: `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
      offset: i,
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth(),
      day: dt.getUTCDate(),
      weekday: dt.getUTCDay(),
    });
  }
  return out;
}

/**
 * Stored MM-DD → the window day it is celebrated on. The nearest occurrence
 * wins, and "02-29" lands on 28 February in a year without a 29th.
 */
export function windowLookup(win: WindowDay[]): Map<string, WindowDay> {
  const map = new Map<string, WindowDay>();
  for (const w of win)
    for (const k of celebrationKeysFor(w.key, w.year)) if (!map.has(k)) map.set(k, w);
  return map;
}

/** Whole years since a stored date, or null when its year is unknown or not past. */
export function yearsTo(iso: string | null, currentYear: number): number | null {
  // A year-less birthday (sentinel year) has no age/anniversary count.
  if (!iso || isYearUnknown(iso)) return null;
  const y = Number(iso.slice(0, 4));
  if (!y) return null;
  const n = currentYear - y;
  return n > 0 ? n : null;
}

export type CelebrationEvent = { kind: string; occasion: string; years: number | null };

/** What one member is celebrated for on a day whose keys are `keys`. */
export function eventsForMember(
  m: {
    dateOfBirth: string | null;
    weddingDate: string | null;
    baptismDate: string | null;
    anniversaries: { label: string; date: string }[] | null;
  },
  keys: string[],
  year: number,
): CelebrationEvent[] {
  const on = (iso: string | null | undefined) => !!iso && keys.includes(iso.slice(5));
  const events: CelebrationEvent[] = [];
  if (on(m.dateOfBirth)) events.push({ kind: "birthday", occasion: "birthday", years: null });
  if (on(m.weddingDate))
    events.push({
      kind: "wedding",
      occasion: "wedding anniversary",
      years: yearsTo(m.weddingDate, year),
    });
  if (on(m.baptismDate))
    events.push({
      kind: "baptism",
      occasion: "baptism anniversary",
      years: yearsTo(m.baptismDate, year),
    });
  for (const a of m.anniversaries ?? [])
    if (on(a.date)) events.push({ kind: a.label, occasion: a.label, years: yearsTo(a.date, year) });
  return events;
}
