/**
 * The `t()` function. Client-safe, no dependencies.
 *
 * Small on purpose. Everything a church-management UI needs is here —
 * lookup, interpolation and plural selection — and nothing else. There is no
 * ICU message parser because no string in this product needs one, and shipping
 * a parser to a phone on a 400kbps link to render "Save" would be a poor trade.
 */

import type { Dictionary } from "./dictionaries/en";
import { DEFAULT_LOCALE, localeInfo, type LocaleCode } from "./locales";

/** A dictionary value: either a plain string, or a pair chosen by a count. */
export type PluralValue = { one: string; other: string };
type Leaf = string | PluralValue;

/**
 * Every valid key, as a dotted path — `"members.title"`, `"common.people"`.
 *
 * This is what makes a typo a compile error instead of a blank space on a
 * screen. Autocomplete works through it too, which is the difference between
 * translators' keys being reused and being reinvented.
 */
export type TKey = DeepKeys<Dictionary>;

type DeepKeys<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${DeepKeys<T[K]>}`;
}[keyof T & string];

export type TVars = Record<string, string | number>;

/** What every component receives. */
export type TFunction = ((key: TKey, vars?: TVars) => string) & {
  /** The locale this `t` was built for — handy for `Intl` calls at call sites. */
  locale: LocaleCode;
  /** The BCP 47 tag for `Intl`. */
  intl: string;
};

function lookup(dict: unknown, key: string): Leaf | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (
    node !== null &&
    typeof node === "object" &&
    typeof (node as PluralValue).other === "string"
  ) {
    return node as PluralValue;
  }
  return undefined;
}

/**
 * `{name}` → the value. Anything with no matching variable is left exactly as
 * it is: a placeholder showing through is a bug a translator can see and
 * report, where silently deleting it hides the mistake in a sentence that
 * still reads.
 */
function interpolate(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Turn what a person would recognise out of a key we somehow cannot resolve.
 *
 * This should never run: `TKey` makes an unknown key a type error, and every
 * locale is typed as `Dictionary`, so nothing can be missing. It exists for the
 * one case types cannot cover — a stale dictionary arriving from an older
 * deployment during a rolling reload — where showing "Save changes" beats
 * showing "common.saveChanges", and both beat a crash.
 */
function humanise(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    // Sentence case, matching how every real string in the dictionary is
    // written: "Save changes", not "Save Changes".
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Build a `t` for one locale and one dictionary.
 *
 * `fallback` is the English dictionary. It is consulted only when the locale's
 * own dictionary has nothing — which, again, the types prevent, but a served
 * page outliving the build that made it does not care about our types.
 */
export function makeT(
  locale: LocaleCode,
  dict: Dictionary | Partial<Dictionary>,
  fallback?: Dictionary,
): TFunction {
  const info = localeInfo(locale);
  /*
   * One PluralRules per `t`, not per call. Constructing an Intl formatter is
   * one of the genuinely expensive things in a render, and a members list
   * asking for "{count} people" once per row would build a hundred of them.
   */
  let rules: Intl.PluralRules | null = null;
  const plural = (n: number): "one" | "other" => {
    try {
      rules ??= new Intl.PluralRules(info.intl);
      return rules.select(n) === "one" ? "one" : "other";
    } catch {
      return n === 1 ? "one" : "other";
    }
  };

  const t = ((key: TKey, vars?: TVars): string => {
    const value = lookup(dict, key) ?? (fallback ? lookup(fallback, key) : undefined);
    if (value === undefined) return humanise(key);

    if (typeof value === "string") return interpolate(value, vars);

    const count = typeof vars?.count === "number" ? vars.count : 0;
    return interpolate(value[plural(count)], vars);
  }) as TFunction;

  t.locale = locale;
  t.intl = info.intl;
  return t;
}

/** A `t` that always answers in English. For tests, and for system output. */
export function englishT(dict: Dictionary): TFunction {
  return makeT(DEFAULT_LOCALE, dict);
}
