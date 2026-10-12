/**
 * Reading an amount a person typed — the ONE parser every money field uses.
 *
 * There used to be four, and every one of them treated "," as a thousands
 * separator and nothing else. On a phone set to Portuguese or French
 * (Mozambique, Angola, the CFA countries) the decimal key on an
 * inputmode="decimal" keypad IS the comma — there is no point to press — so a
 * treasurer typing "1500,50" for MT 1,500.50 had 150050 saved, and
 * "2.500,00" was saved as 2.5. Nothing was refused; the ledger, the fund
 * balances and the pledge progress were simply wrong, by a factor of 100.
 *
 * The rules, in order:
 *
 *   - Spaces (including the no-break spaces French writes thousands with) are
 *     only ever grouping, so they go. A currency symbol or code at either end
 *     goes too ("NGN 750", "₦1,500", "1.500,00 MT"). Letters in the MIDDLE are
 *     refused, so "1e5" is not quietly read as 15.
 *   - Both "," and "." present: whichever comes LAST is the decimal separator,
 *     and the other one must be ordinary 3-digit grouping in front of it.
 *   - Only one kind present, more than once: it is grouping ("1,500,000",
 *     "2.500.000"), and every group after the first must be three digits.
 *   - Only one kind, once, with 1–2 digits after it: the decimal separator,
 *     whichever character it is ("1500,50", "1500.5").
 *   - Only one kind, once, with exactly 3 digits after it: genuinely ambiguous
 *     ("1,500" is fifteen hundred in Lagos and one-and-a-half in Maputo). A
 *     `decimal` hint settles it when the caller knows the church's convention;
 *     without one, a comma is read the way this platform always has (grouping,
 *     so "1,500" stays 1500 for every church that has been typing it) and a
 *     point is a third decimal place, which is refused rather than rounded.
 *   - More than two decimal places is refused, never rounded. A figure that
 *     cannot be money is a typo to show the person, not a guess to save.
 *
 * Pure, and safe to import from a client component, so the "Will save …"
 * preview under a field is computed by exactly the code the server runs.
 */

export type DecimalSeparator = "." | ",";

export type MoneyParse =
  | { ok: true; value: number }
  | { ok: false; error: string };

export type MoneyParseOptions = {
  /**
   * How this church writes a decimal, when known. Only consulted for the one
   * genuinely ambiguous shape: a single separator followed by three digits.
   */
  decimal?: DecimalSeparator;
  /** An opening balance may be zero. A gift or an expense may not. */
  allowZero?: boolean;
  /** An overdrawn account's opening balance is negative, and still a fact. */
  allowNegative?: boolean;
};

/** numeric(14,2) holds twelve digits before the point. */
export const MONEY_INPUT_MAX = 1e12;

export const MONEY_ERRORS = {
  empty: "Enter an amount.",
  notNumber: "Enter the amount as a number, e.g. 1500.50.",
  ambiguous:
    "Can't tell where the decimals start. Type it without a thousands separator, e.g. 1500.50 or 1500,50.",
  tooPrecise: "Use at most two decimal places.",
  notPositive: "The amount must be more than zero.",
  negative: "The amount can't be negative.",
  tooLarge: "That amount is too large.",
} as const;

// Whitespace of every width a keyboard or a spreadsheet produces: ordinary
// space, tab, NBSP, narrow NBSP (French grouping), thin space.
const SPACES = /[\s   ]/g;

function fail(error: string): MoneyParse {
  return { ok: false, error };
}

/** Thousands groups: the first 1–3 digits, every one after exactly 3. */
function isGrouping(groups: string[]): boolean {
  if (groups.length < 2) return true;
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/**
 * The digits of an amount with every separator resolved, as "1234.56", or a
 * reason it cannot be read. Sign and range are checked by the caller.
 */
function canonical(
  body: string,
  hint: DecimalSeparator | undefined,
): { ok: true; text: string } | { ok: false; error: string } {
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) {
    return { ok: false, error: MONEY_ERRORS.notNumber };
  }
  const commas = (body.match(/,/g) ?? []).length;
  const points = (body.match(/\./g) ?? []).length;

  // No separator at all.
  if (commas === 0 && points === 0) return { ok: true, text: body };

  // Both kinds: the last one written is the decimal separator.
  if (commas > 0 && points > 0) {
    const dec: DecimalSeparator =
      body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const group = dec === "," ? "." : ",";
    const cut = body.lastIndexOf(dec);
    const whole = body.slice(0, cut);
    const frac = body.slice(cut + 1);
    // The decimal separator appears once, and nothing but grouping in front.
    if (whole.includes(dec)) return { ok: false, error: MONEY_ERRORS.ambiguous };
    if (!isGrouping(whole.split(group))) {
      return { ok: false, error: MONEY_ERRORS.ambiguous };
    }
    return { ok: true, text: `${whole.split(group).join("")}.${frac}` };
  }

  const sep: DecimalSeparator = commas > 0 ? "," : ".";
  const count = commas + points;
  const parts = body.split(sep);

  // The same separator several times can only be grouping.
  if (count > 1) {
    if (!isGrouping(parts)) return { ok: false, error: MONEY_ERRORS.ambiguous };
    return { ok: true, text: parts.join("") };
  }

  const [whole, frac] = parts;
  // "1500." / "1500," — a separator with nothing after it is just a stray key.
  if (frac.length === 0) return { ok: true, text: whole };
  // One or two digits after: a decimal separator, whichever character it is.
  if (frac.length <= 2) return { ok: true, text: `${whole}.${frac}` };
  // Exactly three after, with a sensible group in front: the ambiguous case.
  if (frac.length === 3 && /^\d{1,3}$/.test(whole)) {
    const decimal: DecimalSeparator = hint ?? ".";
    if (sep === decimal) return { ok: false, error: MONEY_ERRORS.tooPrecise };
    return { ok: true, text: `${whole}${frac}` };
  }
  // Four or more after one separator ("12,3456", "1.23456"): read as decimals,
  // and those are refused below for having too many places. Said plainly:
  return { ok: false, error: sep === "." ? MONEY_ERRORS.tooPrecise : MONEY_ERRORS.ambiguous };
}

/**
 * Parse a typed or imported amount. Returns the value in major units (naira,
 * meticais), rounded to the kobo, or a sentence to show the person.
 */
export function parseMoneyInput(
  input: unknown,
  opts: MoneyParseOptions = {},
): MoneyParse {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return fail(MONEY_ERRORS.notNumber);
    // A JS number never needs the separator rules, only the range ones.
    return finish(Math.abs(input), input < 0, opts);
  }
  if (typeof input !== "string") return fail(MONEY_ERRORS.empty);

  let negative = false;
  let text = input.replace(SPACES, "");
  if (!text) return fail(MONEY_ERRORS.empty);

  // An accountant's negative: "(200)".
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  // A currency symbol or code at either end, and a sign in front of either.
  text = text.replace(/^[^\d.,\-+]+/, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  text = text.replace(/^[^\d.,]+/, "").replace(/[^\d.,]+$/, "");
  if (!text) return fail(MONEY_ERRORS.notNumber);

  const c = canonical(text, opts.decimal);
  if (!c.ok) return c;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(c.text);
  if (!m) return fail(MONEY_ERRORS.notNumber);
  if ((m[2] ?? "").length > 2) return fail(MONEY_ERRORS.tooPrecise);
  const n = Number(`${m[1] || "0"}.${m[2] || "0"}`);
  if (!Number.isFinite(n)) return fail(MONEY_ERRORS.notNumber);
  return finish(n, negative, opts);
}

function finish(abs: number, negative: boolean, opts: MoneyParseOptions): MoneyParse {
  if (abs >= MONEY_INPUT_MAX) return fail(MONEY_ERRORS.tooLarge);
  // Two places, the same way roundMoney does it, so 0.1 + 0.2 never leaks in.
  const rounded = Math.round((abs + Number.EPSILON) * 100) / 100;
  const value = negative ? -rounded : rounded;
  if (value < 0 && !opts.allowNegative) return fail(MONEY_ERRORS.negative);
  if (value === 0 && !opts.allowZero) return fail(MONEY_ERRORS.notPositive);
  // -0 is not a balance anybody means.
  return { ok: true, value: value === 0 ? 0 : value };
}

/** The value, or null — for the callers that only need to know "usable?". */
export function parseMoney(input: unknown, opts?: MoneyParseOptions): number | null {
  const r = parseMoneyInput(input, opts);
  return r.ok ? r.value : null;
}

/**
 * How a church in this country writes a decimal. Used to settle "5.000" in a
 * spreadsheet, where there is nobody to ask. The French- and Portuguese-
 * speaking profiles write a comma, and so do the continental European ones the
 * app serves in English.
 */
const COMMA_DECIMAL_COUNTRIES = new Set([
  "Germany",
  "Netherlands",
  "Italy",
  "Spain",
]);

export function decimalSeparatorFor(
  locale: string | null | undefined,
  country?: string | null,
): DecimalSeparator {
  if (locale === "fr" || locale === "pt") return ",";
  if (country && COMMA_DECIMAL_COUNTRIES.has(country.trim())) return ",";
  return ".";
}
