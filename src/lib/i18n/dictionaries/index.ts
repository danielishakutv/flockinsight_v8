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

export const DICTIONARIES: Record<LocaleCode, Dictionary> = {
  en,
  fr,
  pt,
  ha,
  ig,
  yo,
  sw,
  pcm,
};

export function dictionaryFor(locale: LocaleCode): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export { en };
export type { Dictionary };
