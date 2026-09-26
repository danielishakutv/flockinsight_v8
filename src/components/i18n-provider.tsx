"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import {
  DEFAULT_LOCALE,
  localeInfo,
  type LocaleCode,
} from "@/lib/i18n/locales";
import { makeT, type TFunction } from "@/lib/i18n/translate";

/**
 * The dictionary, handed down from the server.
 *
 * The provider receives ONE locale's dictionary as a prop rather than importing
 * the registry, so a browser downloads the language it is reading and not the
 * other seven. It is a few hundred short strings — a handful of kilobytes over
 * the wire, and it is the same payload for every page in the app, so it is
 * fetched once and then cached with the rest of the RSC tree.
 */

type I18nValue = { locale: LocaleCode; t: TFunction };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: LocaleCode;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: makeT(locale, dict) }),
    [locale, dict],
  );

  /*
   * `lang` and `dir` on <html>, set from here rather than in the root layout.
   *
   * The root layout is shared with the marketing pages, which are statically
   * rendered — reading a cookie there would make every one of them dynamic, and
   * those are precisely the pages people open on a bad connection. Setting the
   * attribute on mount costs nothing, keeps the static pages static, and still
   * gives screen readers and the browser's own translation prompt the right
   * answer.
   */
  useEffect(() => {
    const info = localeInfo(locale);
    const root = document.documentElement;
    const previousLang = root.lang;
    const previousDir = root.dir;
    root.lang = locale;
    root.dir = info.dir;
    return () => {
      root.lang = previousLang;
      root.dir = previousDir;
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * `t` for a client component.
 *
 * Throws when there is no provider above it, on purpose. A silent English
 * fallback would mean a whole panel quietly staying in English on somebody's
 * Yoruba interface, and nobody finding out — where this fails the first time
 * the component is rendered in development.
 */
export function useT(): TFunction {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error(
      "useT() needs an <I18nProvider> above it. The app, auth and meeting layouts each provide one.",
    );
  }
  return ctx.t;
}

/**
 * `t` for the few components rendered in BOTH shells.
 *
 * The activity log is the case this exists for. The same component renders at
 * `/settings/activity`, inside the church app where a provider is present, and
 * at `/superadmin/audit`, inside the platform-admin shell — which is
 * deliberately English-only and has no provider. `useT()` throws there, exactly
 * as it should; weakening it would undo the reason it throws. This is the
 * opt-in version, which says at the call site that English is the right answer
 * when there is no provider above.
 *
 * No dictionary is imported for the fallback, on purpose. An empty one makes
 * every key resolve through `humanise`, so `"activity.whatChanged"` reads as
 * "What changed" — which is why keys in this app are named after the words they
 * hold. English therefore costs nothing on the phone of somebody reading
 * Yoruba, and adds nothing to this component's chunk.
 */
export function useOptionalT(): TFunction {
  const ctx = useContext(I18nContext);
  const fallback = useMemo(() => makeT(DEFAULT_LOCALE, {}), []);
  return ctx?.t ?? fallback;
}

/** The current locale, for `Intl` calls at the call site. */
export function useLocale(): LocaleCode {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useLocale() needs an <I18nProvider> above it.");
  }
  return ctx.locale;
}
