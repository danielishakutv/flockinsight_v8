/**
 * The languages FlockInsight speaks.
 *
 * Client-safe: no dictionaries, no server imports. The picker, the middleware-
 * free locale resolution and the dictionary loader all read this one list.
 *
 * A note on routing, because it is a deliberate departure from the Next.js
 * guide. Next recommends a `/[lang]/…` sub-path, which means every route lives
 * under `app/[lang]/`. This app has 128 of them, and the ones that matter most
 * are links other people already hold: a meeting link read out from a pulpit,
 * a form link in a WhatsApp group, a church's public page, a member's personal
 * update link, every URL in every email we have ever sent. A locale segment
 * would either break all of those or need a redirect layer in front of them,
 * and it would buy nothing: language here is a property of the person, not of
 * the page. So the locale lives in a cookie and in the account, and every URL
 * in the product stays exactly what it was.
 */

export type LocaleCode =
  | "en"
  | "fr"
  | "pt"
  | "ha"
  | "ig"
  | "yo"
  | "sw"
  | "pcm";

export type LocaleInfo = {
  code: LocaleCode;
  /** In English, for an admin choosing on somebody else's behalf. */
  name: string;
  /** In the language itself — what the speaker recognises. */
  native: string;
  dir: "ltr" | "rtl";
  /**
   * Has a fluent speaker been through it?
   *
   * English, French and Portuguese have. The others were written carefully but
   * not by a native speaker, and the UI says so rather than presenting a rough
   * translation as finished work. A church can still choose one — it is far
   * better than English for most of their people — and the note invites them
   * to tell us what is wrong.
   */
  reviewed: boolean;
  /**
   * The BCP 47 tag handed to `Intl` for dates, numbers and plural rules.
   * Several of these have no CLDR data; `Intl` falls back sensibly, and
   * `formatting.ts` pins the ones where the fallback would be wrong.
   */
  intl: string;
};

export const LOCALES: readonly LocaleInfo[] = [
  {
    code: "en",
    name: "English",
    native: "English",
    dir: "ltr",
    reviewed: true,
    intl: "en-GB",
  },
  {
    code: "fr",
    name: "French",
    native: "Français",
    dir: "ltr",
    reviewed: true,
    intl: "fr",
  },
  {
    code: "pt",
    name: "Portuguese",
    native: "Português",
    dir: "ltr",
    reviewed: true,
    intl: "pt",
  },
  {
    code: "ha",
    name: "Hausa",
    native: "Hausa",
    dir: "ltr",
    reviewed: false,
    intl: "ha",
  },
  {
    code: "ig",
    name: "Igbo",
    native: "Igbo",
    dir: "ltr",
    reviewed: false,
    intl: "ig",
  },
  {
    code: "yo",
    name: "Yoruba",
    native: "Yorùbá",
    dir: "ltr",
    reviewed: false,
    intl: "yo",
  },
  {
    code: "sw",
    name: "Swahili",
    native: "Kiswahili",
    dir: "ltr",
    reviewed: false,
    intl: "sw",
  },
  {
    /*
     * Nigerian Pidgin. Not a dialect of English and not a second-class option:
     * it is the language tens of millions of Nigerians are most comfortable
     * in, and for a lot of congregations it is what the service is conducted
     * in. `pcm` is its real ISO code.
     */
    code: "pcm",
    name: "Nigerian Pidgin",
    native: "Naijá Pidgin",
    dir: "ltr",
    reviewed: false,
    intl: "en-NG",
  },
];

export const DEFAULT_LOCALE: LocaleCode = "en";

/** The cookie the picker writes. Read on every request. */
export const LOCALE_COOKIE = "fi_lang";

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && BY_CODE.has(value as LocaleCode);
}

export function localeInfo(code: LocaleCode): LocaleInfo {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

export function localeName(code: string): string {
  return isLocale(code) ? localeInfo(code).native : code;
}

/**
 * Best match for an `Accept-Language` header.
 *
 * Deliberately simple: split, sort by q, and take the first whose primary
 * subtag we speak. A browser sending "fr-CA,fr;q=0.9,en;q=0.8" gets French,
 * and "de,en;q=0.5" gets English rather than nothing. Good enough to open the
 * app in the right language before anyone has chosen one, which is all this is
 * for — the account setting is what actually decides afterwards.
 */
export function matchAcceptLanguage(header: string | null | undefined): LocaleCode | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number(q);
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (isLocale(tag)) return tag;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}
