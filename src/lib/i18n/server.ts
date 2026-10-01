import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, user } from "@/db/schema";
import { en, mergedDictionary, type Dictionary } from "./dictionaries";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  matchAcceptLanguage,
  type LocaleCode,
} from "./locales";
import { makeT, type TFunction } from "./translate";

/**
 * Which language to answer in, and the dictionary to answer with.
 *
 * Resolved per request and cached, so a page that asks five times pays once.
 */

/** Written by the picker when somebody chooses "follow my device". */
export const AUTO_LOCALE = "auto";

/**
 * The order, and why it is this order:
 *
 *   1. The cookie. An explicit choice made in this browser, and the only
 *      thing that works for a guest in a meeting who has no account at all.
 *   2. The signed-in user's saved preference, so the choice follows them to a
 *      new phone without being made again.
 *   3. The church's default, so somebody invited onto the team opens the app
 *      in the language their church works in rather than in English.
 *   4. Accept-Language. Not a guess — it is what the person told their browser.
 *   5. English.
 *
 * The picker writes the cookie AND the user row together, so 1 and 2 never
 * disagree for the person who chose. `auto` in the cookie deliberately skips
 * straight to 4.
 */
export const getLocale = cache(async (): Promise<LocaleCode> => {
  try {
    const jar = await cookies();
    const chosen = jar.get(LOCALE_COOKIE)?.value;
    if (chosen && chosen !== AUTO_LOCALE && isLocale(chosen)) return chosen;

    const followDevice = chosen === AUTO_LOCALE;

    if (!followDevice) {
      const fromAccount = await accountLocale();
      if (fromAccount) return fromAccount;
    }

    const h = await headers();
    return matchAcceptLanguage(h.get("accept-language")) ?? DEFAULT_LOCALE;
  } catch (err) {
    /*
     * MUST come first. `cookies()` and `headers()` bail out of a static render
     * by THROWING, and this catch used to swallow that signal — so every page
     * calling getLocale was prerendered at build time, in English, and stayed
     * English for every visitor no matter which language they picked. The
     * translations were all present; the page serving them was a build-time
     * copy. See next/navigation#unstable_rethrow.
     */
    unstable_rethrow(err);
    // Genuinely no request scope: a script, or a cron tick calling a shared
    // helper. English is the only answer available.
    return DEFAULT_LOCALE;
  }
});

/**
 * The user's own setting, then their church's.
 *
 * Imported lazily and wrapped: this runs on every page, and a page must render
 * in English rather than fail because a locale lookup did.
 */
async function accountLocale(): Promise<LocaleCode | null> {
  try {
    const { getSession, getActAsChurchId } = await import("@/lib/session");
    const data = await getSession();
    if (!data?.user) return null;

    const [row] = await db
      .select({ locale: user.locale })
      .from(user)
      .where(eq(user.id, data.user.id))
      .limit(1);
    if (row?.locale && isLocale(row.locale)) return row.locale;

    const churchId =
      (await getActAsChurchId()) ?? data.session.activeOrganizationId ?? null;
    if (!churchId) return null;

    const [c] = await db
      .select({ locale: church.defaultLocale })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1);
    if (c?.locale && isLocale(c.locale)) return c.locale;

    return null;
  } catch (err) {
    /*
     * Same reason as in getLocale, and easy to miss here because this helper
     * only looks like a database lookup: `getSession()` reads `headers()`,
     * which bails out of a static render by throwing. Swallowing that here
     * would hand back `null` as though the account simply had no locale set.
     * Today getLocale's own `headers()` call rethrows it a moment later, so
     * nothing is visibly broken — but that is luck, not design, and it would
     * vanish the day these calls are reordered.
     */
    unstable_rethrow(err);
    // A real lookup failure. The page renders in English rather than failing
    // because a locale lookup did.
    console.error("i18n: could not read the account locale", err);
    return null;
  }
}

/**
 * The resolved dictionary, complete. Handed to a client provider as a prop.
 *
 * Merged with English here rather than in the browser. The client gets one
 * dictionary — that is why these are passed as a prop instead of imported —
 * so a half-translated language must be completed before it is sent, or the
 * browser would need English beside it and every reader would pay twice.
 */
export const getDictionary = cache(async (): Promise<Dictionary> => {
  return mergedDictionary(await getLocale());
});

/**
 * `t` for a server component.
 *
 * English is passed as the fallback so a page served by a worker that outlives
 * the build which made it still renders words rather than keys. The types make
 * that impossible in a single deployment; a rolling reload is not one.
 */
export const getT = cache(async (): Promise<TFunction> => {
  const locale = await getLocale();
  return makeT(locale, mergedDictionary(locale), en);
});

/** Everything a client provider needs, in one call. */
export const getI18n = cache(
  async (): Promise<{ locale: LocaleCode; dict: Dictionary; t: TFunction }> => {
    const locale = await getLocale();
    const dict = mergedDictionary(locale);
    return { locale, dict, t: makeT(locale, dict, en) };
  },
);

/** What the picker currently shows as selected — `auto` is a real answer. */
export async function getLocalePreference(): Promise<LocaleCode | "auto"> {
  try {
    const jar = await cookies();
    const chosen = jar.get(LOCALE_COOKIE)?.value;
    if (chosen === AUTO_LOCALE) return AUTO_LOCALE;
    if (chosen && isLocale(chosen)) return chosen;
    const fromAccount = await accountLocale();
    return fromAccount ?? AUTO_LOCALE;
  } catch (err) {
    unstable_rethrow(err);
    return AUTO_LOCALE;
  }
}
