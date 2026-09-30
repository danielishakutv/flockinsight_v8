/**
 * What a country implies: its money, its language, and whether we can text it.
 *
 * These three answers were scattered — currency defaulted to NGN for everyone,
 * language defaulted to English for everyone, and SMS availability lived in its
 * own file that only the UI consulted. A church in Maputo therefore signed up
 * to a Nigerian-shaped product: naira in its giving screens, English on every
 * page, and an SMS button that would take its money and deliver nothing.
 *
 * One table instead, consulted at signup and wherever the answer matters.
 * Pure and client-safe: no database, no network, so the signup form can use it
 * while somebody is still choosing a country.
 */

import type { LocaleCode } from "@/lib/i18n/locales";

export type CountryProfile = {
  /** ISO 4217 code, matching an entry in CURRENCIES. */
  currency: string;
  /** The language to start them in. English where we have nothing better. */
  locale: LocaleCode;
  /** International dialling code, without the plus. */
  dial: string;
  /**
   * IANA timezone, used as the church's clock until somebody changes it.
   *
   * This is not cosmetic. Birthday greetings, service reminders and pledge
   * reminders all ask "what is today, there" — so a Maputo church left on
   * Africa/Lagos gets an hour of every day attributed to the wrong date, and
   * a member born just after midnight is greeted a day late, every year.
   *
   * Countries that span several zones get their largest city's, which is the
   * right default and the wrong answer for a minority who can change it in
   * Settings.
   */
  tz: string;
};

/**
 * Countries we can actually deliver SMS to.
 *
 * Nigeria alone, and that is a statement about our gateway rather than about
 * the countries. Termii's sender-ID registration and delivery routes are set
 * up for Nigerian networks; everywhere else a message would be accepted, paid
 * for, and quietly never arrive — which is worse than not offering it, because
 * the church believes its members were told.
 *
 * Adding a country here is a promise. Confirm real delivery to a real handset
 * on that network first.
 */
export const SMS_COUNTRIES: readonly string[] = ["Nigeria"];

export function smsAvailableForCountry(country: string | null | undefined): boolean {
  return !!country && SMS_COUNTRIES.includes(country.trim());
}

/**
 * Currency, language and dial code per country.
 *
 * Africa in full, because that is who this is for, plus the countries a
 * diaspora congregation is most likely to be in. Anything absent falls back to
 * US dollars and English, which is wrong in a recoverable way — the church can
 * change both in Settings — rather than silently charging a Kenyan church in
 * naira.
 */
const PROFILES: Record<string, CountryProfile> = {
  // ---- West Africa
  Nigeria: { currency: "NGN", locale: "en", dial: "234", tz: "Africa/Lagos" },
  Ghana: { currency: "GHS", locale: "en", dial: "233", tz: "Africa/Accra" },
  "Sierra Leone": { currency: "SLE", locale: "en", dial: "232", tz: "Africa/Freetown" },
  Liberia: { currency: "LRD", locale: "en", dial: "231", tz: "Africa/Monrovia" },
  Gambia: { currency: "GMD", locale: "en", dial: "220", tz: "Africa/Banjul" },
  Guinea: { currency: "GNF", locale: "fr", dial: "224", tz: "Africa/Conakry" },
  Senegal: { currency: "XOF", locale: "fr", dial: "221", tz: "Africa/Dakar" },
  "Ivory Coast": { currency: "XOF", locale: "fr", dial: "225", tz: "Africa/Abidjan" },
  "Côte d'Ivoire": { currency: "XOF", locale: "fr", dial: "225", tz: "Africa/Abidjan" },
  Mali: { currency: "XOF", locale: "fr", dial: "223", tz: "Africa/Bamako" },
  "Burkina Faso": { currency: "XOF", locale: "fr", dial: "226", tz: "Africa/Ouagadougou" },
  Benin: { currency: "XOF", locale: "fr", dial: "229", tz: "Africa/Porto-Novo" },
  Togo: { currency: "XOF", locale: "fr", dial: "228", tz: "Africa/Lome" },
  Niger: { currency: "XOF", locale: "fr", dial: "227", tz: "Africa/Niamey" },
  "Guinea-Bissau": { currency: "XOF", locale: "pt", dial: "245", tz: "Africa/Bissau" },
  "Cabo Verde": { currency: "CVE", locale: "pt", dial: "238", tz: "Atlantic/Cape_Verde" },

  // ---- Central Africa
  Cameroon: { currency: "XAF", locale: "fr", dial: "237", tz: "Africa/Douala" },
  Chad: { currency: "XAF", locale: "fr", dial: "235", tz: "Africa/Ndjamena" },
  "Central African Republic": { currency: "XAF", locale: "fr", dial: "236", tz: "Africa/Bangui" },
  Gabon: { currency: "XAF", locale: "fr", dial: "241", tz: "Africa/Libreville" },
  "Republic of the Congo": { currency: "XAF", locale: "fr", dial: "242", tz: "Africa/Brazzaville" },
  "Democratic Republic of the Congo": { currency: "CDF", locale: "fr", dial: "243", tz: "Africa/Kinshasa" },
  "Equatorial Guinea": { currency: "XAF", locale: "pt", dial: "240", tz: "Africa/Malabo" },
  Angola: { currency: "AOA", locale: "pt", dial: "244", tz: "Africa/Luanda" },

  // ---- East Africa
  Kenya: { currency: "KES", locale: "sw", dial: "254", tz: "Africa/Nairobi" },
  Tanzania: { currency: "TZS", locale: "sw", dial: "255", tz: "Africa/Dar_es_Salaam" },
  Uganda: { currency: "UGX", locale: "en", dial: "256", tz: "Africa/Kampala" },
  Rwanda: { currency: "RWF", locale: "fr", dial: "250", tz: "Africa/Kigali" },
  Burundi: { currency: "BIF", locale: "fr", dial: "257", tz: "Africa/Bujumbura" },
  Ethiopia: { currency: "ETB", locale: "en", dial: "251", tz: "Africa/Addis_Ababa" },
  "South Sudan": { currency: "SSP", locale: "en", dial: "211", tz: "Africa/Juba" },
  Somalia: { currency: "SOS", locale: "en", dial: "252", tz: "Africa/Mogadishu" },

  // ---- Southern Africa
  Mozambique: { currency: "MZN", locale: "pt", dial: "258", tz: "Africa/Maputo" },
  "South Africa": { currency: "ZAR", locale: "en", dial: "27", tz: "Africa/Johannesburg" },
  Zambia: { currency: "ZMW", locale: "en", dial: "260", tz: "Africa/Lusaka" },
  Zimbabwe: { currency: "ZWL", locale: "en", dial: "263", tz: "Africa/Harare" },
  Malawi: { currency: "MWK", locale: "en", dial: "265", tz: "Africa/Blantyre" },
  Botswana: { currency: "BWP", locale: "en", dial: "267", tz: "Africa/Gaborone" },
  Namibia: { currency: "NAD", locale: "en", dial: "264", tz: "Africa/Windhoek" },
  Lesotho: { currency: "LSL", locale: "en", dial: "266", tz: "Africa/Maseru" },
  Eswatini: { currency: "SZL", locale: "en", dial: "268", tz: "Africa/Mbabane" },
  "São Tomé and Príncipe": { currency: "STN", locale: "pt", dial: "239", tz: "Africa/Sao_Tome" },

  // ---- North Africa
  Egypt: { currency: "EGP", locale: "en", dial: "20", tz: "Africa/Cairo" },
  Morocco: { currency: "MAD", locale: "fr", dial: "212", tz: "Africa/Casablanca" },
  Algeria: { currency: "DZD", locale: "fr", dial: "213", tz: "Africa/Algiers" },
  Tunisia: { currency: "TND", locale: "fr", dial: "216", tz: "Africa/Tunis" },
  Libya: { currency: "LYD", locale: "en", dial: "218", tz: "Africa/Tripoli" },
  Sudan: { currency: "SDG", locale: "en", dial: "249", tz: "Africa/Khartoum" },

  // ---- Where the diaspora is
  "United Kingdom": { currency: "GBP", locale: "en", dial: "44", tz: "Europe/London" },
  "United States": { currency: "USD", locale: "en", dial: "1", tz: "America/New_York" },
  Canada: { currency: "CAD", locale: "en", dial: "1", tz: "America/Toronto" },
  France: { currency: "EUR", locale: "fr", dial: "33", tz: "Europe/Paris" },
  Belgium: { currency: "EUR", locale: "fr", dial: "32", tz: "Europe/Brussels" },
  Portugal: { currency: "EUR", locale: "pt", dial: "351", tz: "Europe/Lisbon" },
  Brazil: { currency: "BRL", locale: "pt", dial: "55", tz: "America/Sao_Paulo" },
  Germany: { currency: "EUR", locale: "en", dial: "49", tz: "Europe/Berlin" },
  Ireland: { currency: "EUR", locale: "en", dial: "353", tz: "Europe/Dublin" },
  Netherlands: { currency: "EUR", locale: "en", dial: "31", tz: "Europe/Amsterdam" },
  Italy: { currency: "EUR", locale: "en", dial: "39", tz: "Europe/Rome" },
  Spain: { currency: "EUR", locale: "en", dial: "34", tz: "Europe/Madrid" },
  Australia: { currency: "AUD", locale: "en", dial: "61", tz: "Australia/Sydney" },
};

/** Where we land when a country is not in the table. */
export const FALLBACK_PROFILE: CountryProfile = {
  currency: "USD",
  locale: "en",
  dial: "",
  // UTC, not Lagos: a country we cannot place should not be quietly filed
  // under West Africa. Wrong in a way the church will notice and can fix.
  tz: "UTC",
};

export function countryProfile(country: string | null | undefined): CountryProfile {
  if (!country) return PROFILES.Nigeria;
  return PROFILES[country.trim()] ?? FALLBACK_PROFILE;
}

export function currencyForCountry(country: string | null | undefined): string {
  return countryProfile(country).currency;
}

export function localeForCountry(country: string | null | undefined): LocaleCode {
  return countryProfile(country).locale;
}

export function timezoneForCountry(country: string | null | undefined): string {
  return countryProfile(country).tz;
}

/** Every country we have a profile for. Useful for tests and the admin. */
export function knownCountries(): string[] {
  return Object.keys(PROFILES);
}

/**
 * Every timezone any profiled country lands on, plus UTC.
 *
 * The settings dropdown is built from this rather than a hand-written list.
 * A hand-written one had ten entries and did not include Africa/Maputo, so a
 * Mozambican church saw "Africa/Lagos" selected, and saving anything else on
 * that page overwrote its real timezone with Lagos — a silent data loss that
 * then moved every birthday greeting and service reminder by an hour.
 *
 * Derived, so adding a country can never again leave its churches unable to
 * see their own clock.
 */
export function knownTimezones(): string[] {
  const all = new Set(Object.values(PROFILES).map((p) => p.tz));
  all.add("UTC");
  return [...all].sort();
}

/* ============================================================
 * Two-letter codes
 * ========================================================== */

/**
 * ISO-3166 alpha-2 to the country names this app uses.
 *
 * Cloudflare puts the visitor's country in `CF-IPCountry` as a two-letter
 * code, which is the cheapest reliable geolocation there is — it costs nothing
 * and is already in front of every request. The names on the right must match
 * `COUNTRIES` in geo.ts exactly, because that is what gets stored and what the
 * dropdown shows.
 */
const ISO2: Record<string, string> = {
  NG: "Nigeria", GH: "Ghana", SL: "Sierra Leone", LR: "Liberia", GM: "Gambia",
  GN: "Guinea", SN: "Senegal", CI: "Ivory Coast", ML: "Mali", BF: "Burkina Faso",
  BJ: "Benin", TG: "Togo", NE: "Niger", GW: "Guinea-Bissau", CV: "Cabo Verde",
  CM: "Cameroon", TD: "Chad", CF: "Central African Republic", GA: "Gabon",
  CG: "Republic of the Congo", CD: "Democratic Republic of the Congo",
  GQ: "Equatorial Guinea", AO: "Angola",
  KE: "Kenya", TZ: "Tanzania", UG: "Uganda", RW: "Rwanda", BI: "Burundi",
  ET: "Ethiopia", SS: "South Sudan", SO: "Somalia",
  MZ: "Mozambique", ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
  MW: "Malawi", BW: "Botswana", NA: "Namibia", LS: "Lesotho", SZ: "Eswatini",
  ST: "São Tomé and Príncipe",
  EG: "Egypt", MA: "Morocco", DZ: "Algeria", TN: "Tunisia", LY: "Libya",
  SD: "Sudan",
  GB: "United Kingdom", US: "United States", CA: "Canada", FR: "France",
  BE: "Belgium", PT: "Portugal", BR: "Brazil", DE: "Germany", IE: "Ireland",
  NL: "Netherlands", IT: "Italy", ES: "Spain", AU: "Australia",
};

/**
 * The country name for a two-letter code, or null.
 *
 * Null rather than a guess: an unrecognised code should leave the form on its
 * default with the person free to choose, not quietly assert somewhere they
 * are not.
 */
export function countryFromIso2(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();
  // Cloudflare sends XX for an address it cannot place, and T1 for Tor.
  if (key === "XX" || key === "T1" || key.length !== 2) return null;
  return ISO2[key] ?? null;
}
