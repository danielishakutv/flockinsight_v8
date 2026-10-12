/**
 * Birthdays with an OPTIONAL year.
 *
 * Many people only share the day & month of their birthday, so the year is
 * optional. `member.dateOfBirth` is a real DATE column, so a year-less birthday
 * is stored with a sentinel year and the year is hidden wherever the birthday
 * is shown. Everything birthday-related already keys on MM-DD (reminders,
 * celebrations, the dashboard, upcoming lists), so a missing year changes
 * nothing there.
 *
 * The sentinel is a leap year, so 29 February birthdays stay valid dates.
 */
export const BIRTH_YEAR_UNKNOWN = "0004"; // leap year → 29 Feb is valid

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Days per month, with a leap February so 29 Feb is always selectable. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** A typed year that names a real year — four digits, not the sentinel, not 0000. */
function realYear(year: string | null | undefined): number | null {
  const y = (year ?? "").trim();
  if (!/^\d{4}$/.test(y) || y === BIRTH_YEAR_UNKNOWN) return null;
  const n = Number(y);
  return n >= 1 ? n : null;
}

/**
 * Number of days in a birth month ("01".."12"); 31 when the month is unset.
 *
 * With no year, February has 29 so a 29 Feb birthday can always be recorded
 * (it is stored in the leap sentinel year). With a real year it has what that
 * year actually had: "29 Feb 1990" used to be offered, built as 1990-02-29,
 * and refused by Postgres — the member save failed with a generic error, and
 * on the public form a child's birthday made the child silently not exist.
 */
export function daysInBirthMonth(month: string, year?: string): number {
  const m = Number(month);
  if (!(m >= 1 && m <= 12)) return 31;
  const y = realYear(year);
  if (m === 2 && y !== null) return isLeapYear(y) ? 29 : 28;
  return DAYS_IN_MONTH[m - 1];
}

/**
 * True for a "YYYY-MM-DD" that Postgres' `date` will accept: well-formed, a
 * day that exists in that month of that year, and year 1 or later (there is
 * no year 0).
 *
 * Not `calendar-date.ts`'s `isRealCalendarDate`, because that builds the date
 * with `Date.UTC`, which maps years 0–99 onto 1900–1999 — so it calls the
 * birthday sentinel "0004-02-29" impossible. `setUTCFullYear` does no such
 * mapping, so this agrees with the database for every year a row can hold.
 */
export function isStorableDate(iso: string | null | undefined): boolean {
  const m = (iso ?? "").match(ISO_RE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

/** True when a stored birthday carries no real year (the sentinel year). */
export function isYearUnknown(iso: string | null | undefined): boolean {
  return !!iso && iso.slice(0, 4) === BIRTH_YEAR_UNKNOWN;
}

/**
 * Split a stored birthday into editable parts. `year` is "" when unknown; an
 * empty or unrecognised value yields all-empty parts.
 */
export function splitBirthday(iso: string | null | undefined): {
  day: string;
  month: string;
  year: string;
} {
  const m = (iso ?? "").match(ISO_RE);
  if (!m) return { day: "", month: "", year: "" };
  const [, y, mm, dd] = m;
  return { day: dd, month: mm, year: y === BIRTH_YEAR_UNKNOWN ? "" : y };
}

/**
 * Build a stored birthday from parts. A month and day are required; the year is
 * optional (blank, partial or 0000 → the sentinel year). Returns "" when
 * incomplete, and clamps the day to the month IN THAT YEAR (31 Feb → 29 Feb
 * with no year, 29 Feb 1990 → 28 Feb 1990) so the result is always a date
 * Postgres will store.
 */
export function buildBirthday(month: string, day: string, year: string): string {
  const mm = month.trim().padStart(2, "0");
  if (!/^(0[1-9]|1[0-2])$/.test(mm)) return "";
  let d = Number(day);
  if (!Number.isInteger(d) || d < 1) return "";
  const ry = realYear(year);
  const y = ry !== null ? year.trim() : BIRTH_YEAR_UNKNOWN;
  d = Math.min(d, daysInBirthMonth(mm, y));
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Human-friendly birthday: "Jul 15, 1990", or "Jul 15" when the year is
 * unknown. Accepts a stored ISO ("YYYY-MM-DD", sentinel or real) or a year-less
 * "MM-DD" (as produced by CSV export). Returns "" for anything unrecognised.
 */
export function formatBirthday(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  if (!s) return "";
  let month = 0;
  let day = 0;
  let year = "";
  const iso = s.match(ISO_RE);
  if (iso) {
    year = iso[1] === BIRTH_YEAR_UNKNOWN ? "" : iso[1];
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const md = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
    if (!md) return s;
    month = Number(md[1]);
    day = Number(md[2]);
  }
  const mon = MONTHS_SHORT[month - 1];
  if (!mon || !day) return s;
  return year ? `${mon} ${day}, ${year}` : `${mon} ${day}`;
}

/**
 * Birthday for CSV export: "YYYY-MM-DD" when the year is known, "MM-DD" when it
 * isn't. Null/empty passes through as null. The result round-trips back through
 * {@link normalizeBirthday} on import.
 */
export function formatBirthdayForCsv(iso: string | null | undefined): string | null {
  const s = (iso ?? "").trim();
  if (!s) return null;
  const m = s.match(ISO_RE);
  if (!m) return s;
  return m[1] === BIRTH_YEAR_UNKNOWN ? `${m[2]}-${m[3]}` : s;
}

/**
 * Parse a birthday from a CSV / free-text value into a stored ISO. Accepts a
 * full date ("YYYY-MM-DD" or "YYYY/MM/DD") or a year-less "MM-DD" / "MM/DD"
 * (stored with the sentinel year). Returns null when unrecognised — and when
 * the day does not exist in that month.
 *
 * Not clamped, unlike {@link buildBirthday}. The dropdowns clamp because the
 * person is looking at the result as they choose; text arrives from a
 * spreadsheet nobody is watching, and quietly turning "1990-04-31" into the
 * 30th filed a birthday on a day that is nobody's, greeted every year. Null
 * lets the caller name the cell instead.
 */
export function normalizeBirthday(value: string): string | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  const strict = (month: string, day: string, year: string): string | null => {
    const iso = buildBirthday(month, day, year);
    return iso && Number(iso.slice(8)) === Number(day) ? iso : null;
  };
  const full = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (full) return strict(full[2], full[3], full[1]);
  const md = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (md) return strict(md[1], md[2], "");
  return null;
}
