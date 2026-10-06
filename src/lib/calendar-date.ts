/**
 * Calendar dates, as text, with no timezone anywhere near them.
 *
 * This exists because of one thing JavaScript does that almost everybody gets
 * wrong, including two places in this codebase:
 *
 *     new Date("2026-02-31T00:00:00.000Z")   // -> 2026-03-03, not Invalid Date
 *
 * `Date` ROLLS OVER. February the 31st silently becomes March the 3rd, so the
 * usual `Number.isNaN(d.getTime())` check passes an impossible date straight
 * through. `report-range.ts` carried that check under a comment saying it
 * "rejects a well-formed but impossible date like 2026-02-31", which it did
 * not; a range built from one reached Postgres, where `date` is strict and the
 * query aborts.
 *
 * Pure, and safe to import from a client component.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a date that is both well-formed AND exists in the calendar.
 *
 * Checked by round-tripping the parts rather than by parsing: if the date
 * rolled over, the components that come back are not the ones that went in.
 */
export function isRealCalendarDate(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Today as "YYYY-MM-DD", from the local clock.
 *
 * Built from the local parts rather than `toISOString().slice(0,10)`, which
 * converts to UTC first and therefore reports yesterday for anyone west of
 * Greenwich in the evening — a visitor registered at 9pm in Lagos is fine, one
 * registered at 9pm in Toronto would be filed as having come the day before.
 */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
