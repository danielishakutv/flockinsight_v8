/**
 * "Today", in a church's own timezone, as YYYY-MM-DD.
 *
 * The server's clock is not the church's. `new Date().toISOString()` is the
 * UTC day, and `getFullYear()/getDate()` is whatever zone the VPS runs in —
 * neither is right for Lagos (UTC+1) and Nairobi (UTC+3) at once. An online
 * gift paid at 00:30 on 1 January in Lagos was filed on 31 December, in the
 * wrong year of somebody's annual giving statement; a gift at 01:30 on a
 * Sunday in Nairobi landed on Saturday, outside that service's giving.
 *
 * Pure and client-safe. A null zone means the schema default (Lagos), not
 * UTC, because that is what the column says a church without one is in; an
 * unknown zone string falls back to UTC rather than throwing, since a
 * settings typo is not a reason to refuse to record a gift.
 */
export const DEFAULT_CHURCH_TIMEZONE = "Africa/Lagos";

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timezone);
  if (!f) {
    // en-CA formats as YYYY-MM-DD, which is the key format, rather than
    // needing the parts to be reassembled by hand.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    FORMATTERS.set(timezone, f);
  }
  return f;
}

/** The calendar day `now` falls on, in `timezone`. */
export function churchToday(
  timezone: string | null | undefined,
  now: Date = new Date(),
): string {
  const zone = timezone?.trim() || DEFAULT_CHURCH_TIMEZONE;
  try {
    const parts = formatterFor(zone).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const out = `${get("year")}-${get("month")}-${get("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) {
    // RangeError: an unknown zone. Said once in the log, not thrown.
    console.warn("churchToday: unknown timezone, using UTC", { zone }, e);
  }
  return now.toISOString().slice(0, 10);
}
