/**
 * Every dictionary, by locale.
 *
 * Statically imported rather than dynamically. They are plain objects of short
 * strings — the whole set is smaller than one of the icons we used to ship —
 * and a static import means `pnpm exec tsc --noEmit` checks every locale
 * against `Dictionary` on every commit. A dynamic `import()` per locale would
 * defer that check to whenever somebody happened to switch language.
 *
 * This module is imported ONLY from the server (see server.ts) and from the
 * tests. A client component never touches it: the layout resolves one locale
 * and passes that single dictionary down as a prop, so a browser downloads the
 * language it is reading and not the other seven.
 */

import { en, type Dictionary } from "./en";
import { fr } from "./fr";
import { pt } from "./pt";
import { ha } from "./ha";
import { ig } from "./ig";
import { yo } from "./yo";
import { sw } from "./sw";
import { pcm } from "./pcm";
import { DEFAULT_LOCALE, type LocaleCode } from "../locales";

/**
 * `Partial` for everything but English, on purpose.
 *
 * A language is translated a screen at a time, not in one sitting — there are
 * over a thousand strings — and typing every locale as complete meant a key
 * added for one language had to be invented for all eight in the same commit.
 * In practice that produced either a blocked commit or seven placeholder
 * strings that read as translations and were not.
 *
 * Partial means a locale may hold only what has genuinely been translated.
 * Anything missing falls through to English by way of `mergedDictionary`
 * below, so a half-translated language shows real English rather than a key.
 */
export const DICTIONARIES: Record<LocaleCode, Partial<Dictionary>> = {
  en,
  fr,
  pt,
  ha,
  ig,
  yo,
  sw,
  pcm,
};

export function dictionaryFor(locale: LocaleCode): Partial<Dictionary> {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * One complete dictionary: the locale's strings over the English ones.
 *
 * Merged on the SERVER so the browser still receives exactly one dictionary —
 * the reason these are passed down as a prop rather than imported. Sending
 * English alongside as a client-side fallback would double the payload for
 * every reader, to solve a problem the server can solve once.
 *
 * Section by section, because a shallow spread would let a locale that has
 * translated three keys in `nav` erase the forty English ones beside them.
 */
export function mergedDictionary(locale: LocaleCode): Dictionary {
  const own = dictionaryFor(locale);
  if (locale === DEFAULT_LOCALE) return en;

  /*
   * Built by walking English's own sections, so the result cannot gain a
   * section English does not have, and cannot lose one a locale has not
   * translated. The single cast at the end is the honest place for it: the
   * loop guarantees the shape, TypeScript just cannot see that through the
   * index signature.
   */
  const out: Record<string, unknown> = {};
  for (const [section, strings] of Object.entries(en)) {
    const translated = (own as Record<string, unknown>)[section];
    out[section] = { ...(strings as object), ...((translated ?? {}) as object) };
  }
  return out as Dictionary;
}

export { en };
export type { Dictionary };
