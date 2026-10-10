import { DEFAULT_LOCALE, isLocale, type LocaleCode } from "@/lib/i18n/locales";
import { getLocale } from "@/lib/i18n/server";

/**
 * Indexable language URLs for the public marketing pages.
 *
 * ## The problem
 *
 * The site speaks eight languages and a search engine could find none of them.
 * Language is chosen by the `fi_lang` cookie, and a crawler has no cookie — so
 * Googlebot, Bingbot and every AI crawler saw exactly one English copy of every
 * page. Seven translations, fully written and reviewed, were invisible. A
 * French church searching "logiciel de gestion d'église" could not have found
 * the French page because, as far as the index was concerned, it did not exist.
 *
 * ## The fix, and its deliberate limit
 *
 * `?lang=fr` on a marketing page renders that page in French, and `hreflang`
 * declares the set so each language's URL can be indexed separately. The cookie
 * still wins for a human who has chosen; the parameter is for a crawler and for
 * a shared link.
 *
 * It is **marketing pages only**. The signed-in app keeps resolving language
 * from the cookie, the user's saved preference and their church's default,
 * because those pages are not indexed and should not be — and because a
 * `?lang=` on an app route would be a second source of truth competing with a
 * person's saved setting, which is the trap `prefer-declared-state` exists to
 * avoid.
 *
 * ## Only the reviewed languages get an hreflang
 *
 * `LOCALES` has eight entries; three are marked `reviewed`. The other five
 * (Hausa, Igbo, Yoruba, Swahili, Nigerian Pidgin) have app dictionaries but no
 * reviewed landing copy, so `landingContent()` returns English for them.
 * Declaring `hreflang="ha"` on a page that serves English would be a mismatch —
 * a crawler that follows it and finds English learns the annotations on this
 * site cannot be trusted, which costs more than the missing entry gains. They
 * go in as they are reviewed.
 */

/** The languages with reviewed public copy, and therefore an hreflang. */
export const INDEXED_LOCALES: LocaleCode[] = ["en", "fr", "pt"];

/** The query parameter. One name, used by the pages and by the alternates. */
export const LANG_PARAM = "lang";

/**
 * `{ en: "/pricing", fr: "/pricing?lang=fr", "x-default": "/pricing" }`
 *
 * Returned as paths, not absolute URLs: `metadataBase` in the root layout makes
 * them absolute, and hard-coding the host here is how a staging deployment ends
 * up advertising production URLs.
 *
 * `x-default` matters more than it looks. Without it, a visitor whose language
 * is none of the three has no declared page to land on, and search engines pick
 * one arbitrarily per market. English is the right default and saying so
 * explicitly is free.
 */
export function languageAlternates(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of INDEXED_LOCALES) {
    out[code] = code === DEFAULT_LOCALE ? path : withLang(path, code);
  }
  out["x-default"] = path;
  return out;
}

/** Append `?lang=xx`, preserving any query string already on the path. */
export function withLang(path: string, code: LocaleCode): string {
  if (code === DEFAULT_LOCALE) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${LANG_PARAM}=${code}`;
}

/**
 * The canonical URL for this rendering of the page.
 *
 * Each language URL must be canonical to itself. Pointing `?lang=fr` back at
 * `/` would tell the index that the French page is a duplicate of the English
 * one and should be dropped — which is the exact outcome this whole file exists
 * to prevent, and the single most common way an hreflang setup is built
 * backwards.
 */
export function canonicalFor(path: string, locale: LocaleCode): string {
  return INDEXED_LOCALES.includes(locale) ? withLang(path, locale) : path;
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Which language a marketing page should render in.
 *
 * `?lang=` first, then the ordinary resolution — cookie, account, church,
 * Accept-Language, English. The parameter wins because it is the more specific
 * request: somebody following a link that says French wants French, including
 * when that somebody is a crawler.
 *
 * An unknown or malformed value is ignored rather than erroring, so
 * `?lang=klingon` renders the normal page instead of a 500. Note what it does
 * NOT do: it never writes a cookie. A crawler fetching `?lang=pt` must not
 * change what the next visitor from that IP sees, and a person who followed a
 * Portuguese link has not chosen Portuguese for ever.
 */
export async function marketingLocale(
  searchParams?: Promise<SearchParams> | SearchParams,
): Promise<LocaleCode> {
  const params = searchParams ? await searchParams : undefined;
  const raw = params?.[LANG_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && isLocale(value)) return value;
  return getLocale();
}
