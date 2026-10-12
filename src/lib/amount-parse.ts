/**
 * Reading an amount somebody typed, the way they meant it.
 *
 * Every amount box used to do `Number(text.replace(/[^\d.]/g, ""))`, which is
 * English punctuation applied to everybody. A giver at a Maputo church writes
 * five thousand meticais as "5.000" — that is how it is written there — and
 * the page read it as 5. "1.500,00" became 1.5. The Give button did echo
 * "Give MT 5.00", and that was the only thing standing between a church and a
 * gift a thousand times smaller than the one intended.
 *
 * The rule here:
 *
 *  - Spaces of every kind, currency letters and symbols are ignored, so
 *    "MT 5 000", "₦1,500" and "NGN 750" all read. A point or comma straight
 *    after a letter is the abbreviation's ("KSh. 500", "Rs. 1,500"), not
 *    the number's, and goes with the letters.
 *  - With both "." and "," present, the LAST one is the decimal mark and the
 *    other is grouping ("1.500,00", "2,000.50").
 *  - One kind appearing more than once is grouping ("1.000.000"), and every
 *    group after the first must then be three digits, or it is not a number.
 *  - One separator, once, followed by exactly three digits is genuinely
 *    ambiguous: "5.000" is five thousand in Lisbon and five in Lagos. The
 *    convention of the place decides, and the caller is told it was a guess
 *    (`ambiguous`) so a page can show the figure back before money moves.
 *  - Any other single separator is the decimal mark ("12,50", "7.5").
 *
 * Pure and client-safe: the public giving page uses it as you type, and a
 * server action can use the same function on the same text.
 */

import { countryProfile, knownCountries } from "@/lib/country-profile";
import { currencySymbol, formatMoney } from "@/lib/money";

export type DecimalMark = "." | ",";

export type ReadAmount = {
  /** The amount, rounded to kobo/cents; null when the text is not a positive number. */
  value: number | null;
  /**
   * True when the reading depended on the locale's convention (a single "."
   * or "," followed by exactly three digits). Show the parsed figure back.
   */
  ambiguous: boolean;
};

/** numeric(14,2) holds twelve digits before the point. */
const CEILING = 1e12;

const MARKS = new Map<string, DecimalMark>();

/** The decimal mark a locale writes, from the runtime's own CLDR data. */
export function decimalMarkForLocale(locale: string | null | undefined): DecimalMark {
  const key = locale || "en";
  const hit = MARKS.get(key);
  if (hit) return hit;
  let mark: DecimalMark = ".";
  try {
    const part = new Intl.NumberFormat(key)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value;
    // Arabic and a few others use their own marks; anything that is not a
    // comma reads as the English point, which is what the digits typed on a
    // phone keypad will carry anyway.
    mark = part === "," ? "," : ".";
  } catch (err) {
    // An unknown tag is a programming error worth seeing, not a reason to
    // refuse a gift: fall back to the point and say so.
    console.warn(`[amount-parse] unknown locale "${key}"`, err);
  }
  MARKS.set(key, mark);
  return mark;
}

/**
 * The language a church's amounts are written in, from its currency.
 *
 * Public pages know the church's currency but not its country. The first
 * country in the profile table with that currency stands for it — MZN is
 * Mozambique (pt), XOF is Senegal (fr), EUR is France (fr), USD is the
 * United States (en). A currency we have no country for reads as English.
 */
export function amountLocaleForCurrency(currency: string | null | undefined): string {
  if (!currency) return "en";
  const code = currency.trim().toUpperCase();
  for (const country of knownCountries()) {
    const profile = countryProfile(country);
    if (profile.currency === code) return profile.locale;
  }
  return "en";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse what was typed, and say whether the locale had to decide. */
export function readAmount(input: string | null | undefined, locale: string): ReadAmount {
  const none: ReadAmount = { value: null, ambiguous: false };
  if (!input) return none;
  // A minus anywhere is a refund or a typo; neither is a gift.
  if (/[-−]/.test(input)) return none;

  // Keep digits and the two marks; drop every space (NBSP, NNBSP, thin),
  // apostrophe-grouping, currency letters and symbols. A mark that follows a
  // letter belongs to an abbreviation: left in, "KSh. 500" became ".500" and
  // read as half a shilling, with nothing flagged. Only a mark touching the
  // letter: "MT .50" is fifty centavos written with a space, and swallowing
  // that point would read it as fifty meticais.
  const s = input.replace(/(\p{L})[.,]/gu, "$1").replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return none;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let intPart: string;
  let fracPart = "";
  let ambiguous = false;

  if (dots > 0 && commas > 0) {
    const decimal: DecimalMark = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    const at = s.lastIndexOf(decimal);
    // The decimal mark appears once, after every grouping mark.
    if (s.indexOf(decimal) !== at) return none;
    const whole = s.slice(0, at);
    if (!groupsValid(whole.split(group))) return none;
    intPart = whole.split(group).join("");
    fracPart = s.slice(at + 1);
  } else if (dots + commas === 0) {
    intPart = s;
  } else {
    const mark: DecimalMark = dots > 0 ? "." : ",";
    const pieces = s.split(mark);
    if (pieces.length > 2) {
      // "1.000.000": only grouping repeats.
      if (!groupsValid(pieces)) return none;
      intPart = pieces.join("");
    } else {
      const [head, tail] = pieces as [string, string];
      // Only "5.000" can be grouping; "12500.000" or "0.500" cannot (a
      // grouped lead is one to three digits and never starts with 0), so
      // those are a decimal mark whatever the locale.
      if (tail.length === 3 && /^[1-9]\d{0,2}$/.test(head)) {
        ambiguous = true;
        if (decimalMarkForLocale(locale) === mark) {
          intPart = head;
          fracPart = tail;
        } else {
          intPart = head + tail;
        }
      } else {
        intPart = head;
        fracPart = tail;
      }
    }
  }

  const text = `${intPart || "0"}${fracPart ? `.${fracPart}` : ""}`;
  if (!/^\d+(\.\d+)?$/.test(text)) return none;
  const n = Number(text);
  if (!Number.isFinite(n) || n >= CEILING) return none;
  const value = round2(n);
  if (value <= 0) return none;
  return { value, ambiguous };
}

/** Just the number: null for anything that is not a finite positive amount. */
export function parseLocaleAmount(
  input: string | null | undefined,
  locale: string,
): number | null {
  return readAmount(input, locale).value;
}

/**
 * An amount drawn the way it was read: in the same convention the parser used.
 *
 * The echo under an amount box exists to settle an ambiguous "5.000". Drawn
 * with `formatMoney`'s English punctuation it said "MT 5,000.00" to a Maputo
 * giver, which in their convention is malformed or reads as five — the one
 * line meant to clear the doubt was itself in doubt. So the digits follow the
 * locale ("MT 5.000,00"), and the symbol still comes from our own table,
 * because CLDR's narrow symbols differ by locale and by ICU version.
 *
 * Client-only use (it follows what was typed, so it never meets hydration).
 * A locale the runtime refuses falls back to `formatMoney`, and says so.
 */
export function formatAmountInLocale(value: number, currency: string, locale: string): string {
  try {
    const body = new Intl.NumberFormat(locale || "en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
    const symbol = currencySymbol(currency);
    const gap = [...symbol].length > 1 ? " " : "";
    return `${value < 0 ? "-" : ""}${symbol}${gap}${body}`;
  } catch (err) {
    console.warn(`[amount-parse] cannot format in "${locale}"`, err);
    return formatMoney(value, currency);
  }
}

/**
 * Grouped digits look like "1" "000" "000": a lead of one to three digits,
 * then threes. "1.5.2" is not a number, and guessing at it with somebody's
 * money is worse than asking again.
 */
function groupsValid(groups: string[]): boolean {
  if (groups.length === 0) return false;
  const [lead, ...rest] = groups;
  if (!/^\d{1,3}$/.test(lead)) return false;
  return rest.every((g) => /^\d{3}$/.test(g));
}
