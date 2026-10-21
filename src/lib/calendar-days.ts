import { wallClockIn } from "@/lib/meeting-recurrence";

/**
 * Which calendar days an entry touches, and which day "today" is.
 *
 * Moved out of the facilities month grid so the pastoral diary can use the
 * same rule in the CHURCH's timezone. Without a zone everything here reads
 * the browser's clock, byte for byte the behaviour the facilities calendar
 * always had. With one, a 23:30 UTC start in Lagos (00:30 local) lands on the
 * next day, which is the day the pastor will actually be sitting there.
 *
 * Pure and client-safe.
 */

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ymdUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" for an instant, in `timeZone` or else the browser's zone. */
export function dayKeyIn(at: Date, timeZone?: string): string {
  if (!timeZone) return ymdLocal(at);
  const w = wallClockIn(at, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Every day an entry touches, so a three-day booking shows on all three. */
export function daysCovered(startsAt: string, endsAt: string, timeZone?: string): string[] {
  if (!timeZone) return daysCoveredLocal(startsAt, endsAt);

  const s = wallClockIn(new Date(startsAt), timeZone);
  const e = wallClockIn(new Date(endsAt), timeZone);
  const first = Date.UTC(s.year, s.month - 1, s.day);
  const last = Date.UTC(e.year, e.month - 1, e.day);
  // The same midnight rule as below, read on the church's wall clock.
  const endsAtMidnight = e.hour === 0 && e.minute === 0;
  const out: string[] = [];
  // Calendar dates stepped in UTC, so no daylight-saving day is 23 hours long.
  for (let cur = first; cur <= last; cur += DAY_MS) {
    if (!(endsAtMidnight && cur === last && out.length > 0)) out.push(ymdUtc(cur));
  }
  return out.length ? out : [ymdUtc(first)];
}

/** The facilities calendar's original rule, unchanged. */
function daysCoveredLocal(startsAt: string, endsAt: string): string[] {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const out: string[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  // The end is exclusive at midnight: a booking ending 09:00 Tuesday covers
  // Tuesday, but one ending exactly at midnight does not spill into it.
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const endsAtMidnight =
    e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0;
  while (cur.getTime() <= last.getTime()) {
    if (!(endsAtMidnight && cur.getTime() === last.getTime() && out.length > 0)) {
      out.push(ymdLocal(cur));
    }
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return out.length ? out : [ymdLocal(s)];
}
