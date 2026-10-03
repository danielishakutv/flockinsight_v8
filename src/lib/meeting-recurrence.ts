/**
 * When a repeating meeting next falls due.
 *
 * No server dependencies, no date library: safe to import from the dialog, the
 * cron and a test. All of it is pure, because this is the one part of recurring
 * meetings that is easy to get quietly wrong — a meeting that lands an hour
 * late twice a year, or on the 31st of February, is not something anybody
 * reports as a bug. They just stop trusting the schedule.
 *
 * Two rules it holds to:
 *
 *   1. **The wall clock is what was promised.** Wednesday prayer at 6pm is at
 *      6pm, in the church's own timezone, for ever. So the arithmetic is done
 *      on the local calendar and converted back to an instant afterwards —
 *      never by adding 7×24 hours, which moves the meeting an hour either way
 *      across a daylight-saving boundary.
 *   2. **The next occurrence is in the future.** A series nobody opened for
 *      three weeks rolls forward to the next Wednesday that has not happened,
 *      not to one three weeks ago, which would be cancelled again on the next
 *      sweep and never catch up.
 */

export const MEETING_REPEATS = [
  "none",
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "monthly-weekday",
] as const;
export type MeetingRepeat = (typeof MEETING_REPEATS)[number];

export function isMeetingRepeat(v: unknown): v is MeetingRepeat {
  return typeof v === "string" && (MEETING_REPEATS as readonly string[]).includes(v);
}

/**
 * How many occurrences in a row may be missed before the series gives up.
 *
 * A church that creates "every Wednesday" and then forgets about it would
 * otherwise have a meeting generated for it every week for ever. Six weeks of
 * nobody opening the room is a clear enough answer, and the series stops with a
 * row left on the list rather than disappearing — so it can be put back on.
 */
export const MAX_MISSED_RUNS = 6;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const ORDINALS = ["first", "second", "third", "fourth", "last"] as const;

/* ============================================================
 * Timezones, with Intl and nothing else
 *
 * The house pattern (see lib/service-reminders.ts): read the parts of an
 * instant as some timezone sees them, and go back the other way by measuring
 * the offset at the answer.
 * ========================================================== */

type Wall = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
};

/** How a given timezone reads an instant. */
export function wallClockIn(at: Date, tz: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl says "24" for midnight in some locales/engines; everywhere else it is 0.
  const hour = get("hour") === 24 ? 0 : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

/** Minutes east of UTC in `tz` at this instant. +60 for Lagos, -300 for New York in winter. */
function offsetMinutes(at: Date, tz: string): number {
  const w = wallClockIn(at, tz);
  const seconds = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, second: "2-digit" })
      .formatToParts(at)
      .find((p) => p.type === "second")?.value ?? "0",
  );
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, seconds);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/**
 * A local wall clock, as an instant.
 *
 * Measured twice on purpose. The first guess uses the offset in force at the
 * WRONG moment — which is only wrong at all within a day of a clock change, and
 * that is exactly when a weekly meeting slips an hour. The second measurement
 * is taken at the answer, which is where the question was really about.
 */
export function instantFromWallClock(w: Wall, tz: string): Date {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const first = naive - offsetMinutes(new Date(naive), tz) * 60_000;
  const second = naive - offsetMinutes(new Date(first), tz) * 60_000;
  return new Date(second);
}

/** Which weekday a local date falls on. 0 = Sunday. */
function weekdayOf(w: Wall): number {
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/** How many days are in a local month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shift a local date by whole days, keeping the time of day exactly. */
function addDays(w: Wall, days: number): Wall {
  const shifted = new Date(Date.UTC(w.year, w.month - 1, w.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: w.hour,
    minute: w.minute,
  };
}

/**
 * Shift a local date by whole months, clamped to the end of the month.
 *
 * The 31st of a month followed by a 30-day one becomes the 30th, and the 31st of
 * January becomes the 28th or the 29th of February. It does NOT spill into
 * March, which is what naive date arithmetic does and which would move a monthly
 * board meeting to the start of the wrong month.
 */
function addMonths(w: Wall, months: number): Wall {
  const total = w.year * 12 + (w.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return {
    year,
    month,
    day: Math.min(w.day, daysInMonth(year, month)),
    hour: w.hour,
    minute: w.minute,
  };
}

/**
 * Which "first/second/third/fourth/fifth <weekday>" a local date is.
 *
 * A fifth Monday only happens in some months, so an ordinal of 5 is read as
 * "the last one" everywhere it is used — `nthWeekdayOfMonth` clamps, and
 * `describeRepeat` says "last". That is the only reading that lands every month.
 */
export function weekdayOrdinalOf(w: Wall): { weekday: number; ordinal: number } {
  return { weekday: weekdayOf(w), ordinal: Math.floor((w.day - 1) / 7) + 1 };
}

/** The date of the nth given weekday in a local month, clamped to the last one. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstOfKind = 1 + ((weekday - firstWeekday + 7) % 7);
  const wanted = firstOfKind + (ordinal - 1) * 7;
  const last = firstOfKind + Math.floor((daysInMonth(year, month) - firstOfKind) / 7) * 7;
  return Math.min(wanted, last);
}

/* ============================================================
 * The rule itself
 * ========================================================== */

/** One step of the rule, from a local wall clock. */
function advance(w: Wall, repeat: Exclude<MeetingRepeat, "none">, anchor: Wall): Wall {
  switch (repeat) {
    case "daily":
      return addDays(w, 1);
    case "weekly":
      return addDays(w, 7);
    case "fortnightly":
      return addDays(w, 14);
    case "monthly":
      /*
       * Anchored to the ORIGINAL day of the month, not the current one. A
       * series that starts on the 31st passes through February as the 28th, and
       * reading the day off that would drag every month afterwards down to the
       * 28th as well — a monthly meeting that silently walks backwards through
       * the calendar.
       */
      return addMonths(
        { year: w.year, month: w.month, day: anchor.day, hour: w.hour, minute: w.minute },
        1,
      );
    case "monthly-weekday": {
      const { weekday, ordinal } = weekdayOrdinalOf(anchor);
      const next = addMonths({ ...w, day: 1 }, 1);
      return {
        ...next,
        day: nthWeekdayOfMonth(next.year, next.month, weekday, ordinal),
        hour: w.hour,
        minute: w.minute,
      };
    }
  }
}

/**
 * The next time this series falls due after `after`.
 *
 * `from` is the occurrence we are rolling forward from and `anchor` is the one
 * the series was first set up with — they differ for the two monthly rules,
 * where the original date is what says "the 31st" or "the first Sunday" and the
 * current one has possibly been clamped.
 *
 * Returns null for a rule that is not a rule, or when the series has run past
 * its end date.
 */
export function nextOccurrence(opts: {
  from: Date;
  repeat: MeetingRepeat;
  timezone: string;
  /** Nothing on or before this instant is a next occurrence. Defaults to now. */
  after?: Date;
  /** The first occurrence of the series, when it is not `from`. */
  anchor?: Date;
  /** The series stops after this instant. */
  until?: Date | null;
}): Date | null {
  const { from, repeat, timezone, until } = opts;
  if (repeat === "none") return null;
  if (Number.isNaN(from.getTime())) return null;

  const after = opts.after ?? new Date();
  const anchorWall = wallClockIn(opts.anchor ?? from, timezone);
  let wall = wallClockIn(from, timezone);

  /*
   * Bounded. The loop only ever runs more than once for a series that was left
   * alone for a while, and 400 steps covers more than a year of a daily meeting
   * — past which "the next one" is not a useful answer and the series has
   * clearly been abandoned.
   */
  for (let step = 0; step < 400; step++) {
    wall = advance(wall, repeat, anchorWall);
    const at = instantFromWallClock(wall, timezone);
    if (at.getTime() <= after.getTime()) continue;
    if (until && at.getTime() > until.getTime()) return null;
    return at;
  }
  return null;
}

/* ============================================================
 * Saying it out loud
 *
 * English, here, for the same reason the engine's reasons are English: this is
 * the shape of the sentence. The dictionary holds the words — see
 * `repeatSummaryKey` below, which the UI uses to translate it.
 * ========================================================== */

/**
 * "Every Wednesday", "Every month on the first Sunday" — from the date it
 * starts, because that is what the rule is anchored to.
 */
export function describeRepeat(
  repeat: MeetingRepeat,
  startsAt: Date | null,
  timezone: string,
): string | null {
  if (repeat === "none") return null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    // A repeat with no start date has nothing to repeat from.
    return null;
  }
  const w = wallClockIn(startsAt, timezone);
  const day = DAY_NAMES[weekdayOf(w)];

  switch (repeat) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every ${day}`;
    case "fortnightly":
      return `Every other ${day}`;
    case "monthly":
      return `Monthly, on the ${ordinalDay(w.day)}`;
    case "monthly-weekday": {
      const { ordinal } = weekdayOrdinalOf(w);
      const which = ORDINALS[Math.min(ordinal, ORDINALS.length) - 1];
      return `Monthly, on the ${which} ${day}`;
    }
  }
}

/** 1 → "1st", 22 → "22nd". */
export function ordinalDay(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}
