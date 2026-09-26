/**
 * Dates and numbers in the reader's language. Client-safe.
 *
 * NOT money. `formatMoney` in lib/money.ts deliberately leaves the locale
 * undefined, because passing one made the same amount render "₦2,000.00" on
 * the server and "NGN 2,000.00" in the browser — a figure changing shape
 * between a page and a client component beside it. That comment is load-bearing
 * and nothing here touches it: currency is a property of the church, not of the
 * person reading.
 */

import { localeInfo, type LocaleCode } from "./locales";

/**
 * Locales with no CLDR data in most runtimes.
 *
 * `Intl` given "yo" or "pcm" silently falls back to the system default, which
 * on a server in Germany means German month names in a Yoruba interface. These
 * map to the closest tag that definitely has data AND the right conventions —
 * day-before-month, 24-hour where that is what people use.
 */
const INTL_FALLBACK: Partial<Record<LocaleCode, string>> = {
  ha: "en-NG",
  ig: "en-NG",
  yo: "en-NG",
  pcm: "en-NG",
  sw: "sw-KE",
};

function tagFor(locale: LocaleCode): string {
  const info = localeInfo(locale);
  const preferred = info.intl;
  try {
    // Does this runtime actually have data for it? `supportedLocalesOf` answers
    // without throwing, and an empty result means it would have fallen back.
    if (Intl.DateTimeFormat.supportedLocalesOf([preferred]).length > 0) {
      return preferred;
    }
  } catch {
    /* fall through to the mapping */
  }
  return INTL_FALLBACK[locale] ?? "en-GB";
}

/** Cached per locale+shape: building an Intl formatter is not cheap. */
const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(
  locale: LocaleCode,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tagFor(locale), options);
    dateCache.set(key, f);
  }
  return f;
}

export function formatDate(
  value: Date | string | number,
  locale: LocaleCode,
  style: "short" | "medium" | "long" = "medium",
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short" }
      : style === "long"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric" };
  return dateFormatter(locale, options).format(d);
}

export function formatTime(value: Date | string | number, locale: LocaleCode): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateFormatter(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDateTime(
  value: Date | string | number,
  locale: LocaleCode,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateFormatter(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatNumber(value: number, locale: LocaleCode): string {
  try {
    return new Intl.NumberFormat(tagFor(locale)).format(value);
  } catch {
    return String(value);
  }
}

/**
 * The weekday names a service picker needs, starting at Sunday — which is where
 * a church week starts, whatever the locale's own convention is.
 */
export function weekdayNames(
  locale: LocaleCode,
  width: "long" | "short" = "long",
): string[] {
  const f = dateFormatter(locale, { weekday: width });
  // 2026-03-01 was a Sunday. Any known Sunday does; this one is a plain date
  // with no daylight-saving edge in any timezone we serve.
  return Array.from({ length: 7 }, (_, i) =>
    f.format(new Date(Date.UTC(2026, 2, 1 + i))),
  );
}
