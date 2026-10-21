import { instantFromWallClock, wallClockIn } from "@/lib/meeting-recurrence";

/**
 * Times a church types, read in the CHURCH's timezone.
 *
 * A `datetime-local` field posts "2026-10-14T18:30" — a wall-clock time with no
 * zone. `new Date("2026-10-14T18:30")` reads that in the zone of whatever
 * process happens to parse it, which on the server is the VPS's clock, not the
 * church's. A Nairobi church's 18:30 prayer meeting was stored three hours
 * late, the meeting page (which renders in the church's zone) showed 21:30,
 * reminders and the missed-meeting sweep fired at the wrong hour — and every
 * open-and-save of the edit dialog shifted it again. A Lagos church on a UTC
 * server was an hour out.
 *
 * Pure, and independent of process.env.TZ, so it can be tested as such.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An explicit offset or Z: already an instant, nothing to interpret. */
const ZONED_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * "2026-10-14T18:30" as the instant it names in `tz`, or null when it is not
 * a real time there — a nonsense date, or the hour a DST change skips.
 *
 * A string that already carries a zone ("…Z", "…+01:00") is taken as the
 * instant it says, so a caller that sends ISO is not reinterpreted.
 */
export function parseWallClockInput(input: string, tz: string): Date | null {
  const s = input.trim();
  if (ZONED_RE.test(s) && s.includes("T")) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = LOCAL_RE.exec(s);
  if (!m) return null;
  const wall = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;

  const at = instantFromWallClock(wall, tz);
  if (Number.isNaN(at.getTime())) return null;
  /*
   * Round-trip: the instant must read back as the same wall clock in `tz`.
   * The 31st of a 30-day month, or 02:30 on the night clocks go forward, has
   * no such instant, and silently becoming some other time is worse than
   * being asked again.
   */
  const back = wallClockIn(at, tz);
  if (
    back.year !== wall.year ||
    back.month !== wall.month ||
    back.day !== wall.day ||
    back.hour !== wall.hour ||
    back.minute !== wall.minute
  )
    return null;
  return at;
}

/**
 * The last moment of a calendar day in `tz` — "until the 31st" includes the
 * whole of the 31st there, not of the server's 31st.
 */
export function endOfLocalDay(date: string, tz: string): Date | null {
  const m = DATE_RE.exec(date.trim());
  if (!m) return null;
  const start = parseWallClockInput(`${m[1]}-${m[2]}-${m[3]}T23:59`, tz);
  return start ? new Date(start.getTime() + 59_999) : null;
}

/**
 * An instant as "YYYY-MM-DDTHH:mm" in `tz`, for filling a datetime-local field
 * so that opening and saving changes nothing.
 */
export function toWallClockInput(at: Date, tz: string): string {
  const w = wallClockIn(at, tz);
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(w.year, 4)}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
}

/**
 * The calendar day an instant falls on in `tz`, as "YYYY-MM-DD" — for a date
 * field, or for filing something under the day the church lived it.
 * `toISOString().slice(0, 10)` is UTC's day, which puts a 7:30pm service in
 * New York on the Thursday after it.
 */
export function toLocalDateInput(at: Date, tz: string): string {
  return toWallClockInput(at, tz).slice(0, 10);
}
