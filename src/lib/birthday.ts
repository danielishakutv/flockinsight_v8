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

/** Number of days in a birth month ("01".."12"); 31 when the month is unset. */
export function daysInBirthMonth(month: string): number {
  const m = Number(month);
  return m >= 1 && m <= 12 ? DAYS_IN_MONTH[m - 1] : 31;
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
 * optional (blank or partial → the sentinel year). Returns "" when incomplete,
 * and clamps the day to the month (e.g. 31 Feb → 29 Feb) so the result is
 * always a valid date.
 */
export function buildBirthday(month: string, day: string, year: string): string {
  const mm = month.trim().padStart(2, "0");
  if (!/^(0[1-9]|1[0-2])$/.test(mm)) return "";
  let d = Number(day);
  if (!Number.isInteger(d) || d < 1) return "";
  d = Math.min(d, daysInBirthMonth(mm));
  const dd = String(d).padStart(2, "0");
  const y = /^\d{4}$/.test(year.trim()) ? year.trim() : BIRTH_YEAR_UNKNOWN;
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
 * (stored with the sentinel year). Returns null when unrecognised.
 */
export function normalizeBirthday(value: string): string | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  const full = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (full) return buildBirthday(full[2], full[3], full[1]) || null;
  const md = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (md) return buildBirthday(md[1], md[2], "") || null;
  return null;
}
