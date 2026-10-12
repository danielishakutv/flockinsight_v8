import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROFILE,
  SMS_COUNTRIES,
  countryProfile,
  currencyForCountry,
  hasNumberingPlan,
  isValidTimeZone,
  knownCountries,
  localeForCountry,
  nationalLengthForDial,
  smsAvailableForCountry,
} from "@/lib/country-profile";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { CURRENCIES } from "@/lib/money";
import { COUNTRIES } from "@/lib/geo";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * What a country implies. The cases that matter are the ones where getting it
 * wrong is invisible: a church charged in the wrong money, or shown an SMS
 * button that takes payment and delivers nothing.
 */

describe("currency", () => {
  it("gives every profiled country a currency the app can actually name", () => {
    // A country defaulting to a code missing from CURRENCIES lands a church on
    // money its own giving screen cannot render.
    const known = new Set(CURRENCIES.map((c) => c.code));
    for (const country of knownCountries()) {
      expect(known.has(currencyForCountry(country)), `${country}`).toBe(true);
    }
    expect(known.has(FALLBACK_PROFILE.currency)).toBe(true);
  });

  it("does not put a Mozambican church in naira", () => {
    expect(currencyForCountry("Mozambique")).toBe("MZN");
    expect(currencyForCountry("Kenya")).toBe("KES");
    expect(currencyForCountry("France")).toBe("EUR");
    expect(currencyForCountry("Nigeria")).toBe("NGN");
  });

  it("falls back to dollars for a country we have not profiled", () => {
    // Wrong in a recoverable way — the church can change it — rather than
    // silently charging a stranger in naira.
    expect(currencyForCountry("Mongolia")).toBe("USD");
  });

  it("defaults to Nigeria when the country is not set at all", () => {
    expect(currencyForCountry(null)).toBe("NGN");
    expect(currencyForCountry(undefined)).toBe("NGN");
  });

  it("ignores stray whitespace", () => {
    expect(currencyForCountry("  Mozambique  ")).toBe("MZN");
  });
});

describe("language", () => {
  it("only ever picks a language we actually ship", () => {
    const shipped = new Set(LOCALES.map((l) => l.code));
    for (const country of knownCountries()) {
      expect(shipped.has(localeForCountry(country)), `${country}`).toBe(true);
    }
  });

  it("starts a Mozambican church in Portuguese", () => {
    expect(localeForCountry("Mozambique")).toBe("pt");
    expect(localeForCountry("Angola")).toBe("pt");
    expect(localeForCountry("Brazil")).toBe("pt");
  });

  it("starts a francophone church in French", () => {
    expect(localeForCountry("Senegal")).toBe("fr");
    expect(localeForCountry("Cameroon")).toBe("fr");
    expect(localeForCountry("France")).toBe("fr");
  });

  it("starts an East African church in English until Swahili is complete", () => {
    // About a third of the app is in Swahili, unreviewed; defaulting a Kenyan
    // pastor into it gave every screen two languages at once.
    expect(localeForCountry("Kenya")).toBe("en");
    expect(localeForCountry("Tanzania")).toBe("en");
  });

  it("never starts a country in a language that is mostly untranslated", () => {
    const leaves = (o: unknown): number =>
      o && typeof o === "object"
        ? Object.values(o as Record<string, unknown>).reduce<number>(
            (n, v) => n + leaves(v),
            0,
          )
        : 1;
    const full = leaves(DICTIONARIES.en);
    for (const c of knownCountries()) {
      const loc = localeForCountry(c);
      if (loc === "en") continue;
      const share = leaves(DICTIONARIES[loc]) / full;
      expect(share, `${c} starts in ${loc}, ${Math.round(share * 100)}% translated`).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe("isValidTimeZone", () => {
  it("accepts every timezone a country profile lands on", () => {
    for (const c of knownCountries()) expect(isValidTimeZone(countryProfile(c).tz), c).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("refuses what Intl would throw on, which used to stop the crons for everybody", () => {
    expect(isValidTimeZone("GMT+2")).toBe(false);
    expect(isValidTimeZone("Africa/Atlantis")).toBe(false);
    expect(isValidTimeZone("Africa/Maputo ")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe("SMS availability", () => {
  it("is Nigeria only, and that is about our gateway rather than the country", () => {
    expect(smsAvailableForCountry("Nigeria")).toBe(true);
    for (const c of ["Mozambique", "Kenya", "France", "Ghana", "South Africa"]) {
      expect(smsAvailableForCountry(c), c).toBe(false);
    }
  });

  it("refuses an unset country rather than assuming Nigeria", () => {
    // Defaulting to "yes" here would charge a church for messages that never
    // arrive, which is the failure this whole gate exists to prevent.
    expect(smsAvailableForCountry(null)).toBe(false);
    expect(smsAvailableForCountry(undefined)).toBe(false);
    expect(smsAvailableForCountry("")).toBe(false);
  });

  it("lists only countries that exist in the country dropdown", () => {
    for (const c of SMS_COUNTRIES) expect(COUNTRIES).toContain(c);
  });
});

describe("timezones", () => {
  it("gives every profiled country a timezone the runtime can actually use", async () => {
    // A bad IANA name throws at format time, inside a cron, at 6am.
    const { knownCountries, countryProfile } = await import(
      "@/lib/country-profile"
    );
    for (const country of knownCountries()) {
      const tz = countryProfile(country).tz;
      expect(() =>
        new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date()),
        `${country} -> ${tz}`,
      ).not.toThrow();
    }
  });

  it("does not put a Mozambican church on Lagos time", async () => {
    /*
     * An hour of every day filed under the wrong date. Birthday greetings and
     * service reminders both ask "what is today, there", so the church would
     * see the symptom as messages arriving on the wrong day, which looks like
     * a bug in reminders rather than a bug in a default.
     */
    const { timezoneForCountry } = await import("@/lib/country-profile");
    expect(timezoneForCountry("Mozambique")).toBe("Africa/Maputo");
    expect(timezoneForCountry("Kenya")).toBe("Africa/Nairobi");
    expect(timezoneForCountry("Nigeria")).toBe("Africa/Lagos");
  });

  it("uses UTC for a country we cannot place, not Lagos", async () => {
    const { timezoneForCountry } = await import("@/lib/country-profile");
    expect(timezoneForCountry("Mongolia")).toBe("UTC");
  });

  it("offers every profiled timezone in the settings list", async () => {
    /*
     * The settings dropdown is built from this. A hand-written list missing
     * Africa/Maputo meant a Mozambican church saw Lagos selected, and saving
     * that page silently overwrote its real timezone.
     */
    const { knownTimezones, knownCountries, countryProfile } = await import(
      "@/lib/country-profile"
    );
    const offered = new Set(knownTimezones());
    for (const country of knownCountries()) {
      expect(offered.has(countryProfile(country).tz), country).toBe(true);
    }
    expect(offered.has("UTC")).toBe(true);
  });
});

describe("dial codes", () => {
  it("knows the codes for the countries we are onboarding first", () => {
    expect(countryProfile("Mozambique").dial).toBe("258");
    expect(countryProfile("Nigeria").dial).toBe("234");
    expect(countryProfile("Kenya").dial).toBe("254");
  });

  it("has a numbering plan for every country it has a dial code for", () => {
    // Without one, a country's numbers are only checked for being 7–12 digits,
    // which is how a Nigerian number one digit short used to get through.
    for (const country of knownCountries()) {
      const dial = countryProfile(country).dial;
      expect(hasNumberingPlan(dial), `${country} (+${dial})`).toBe(true);
    }
  });

  it("holds Nigeria to exactly ten digits, as Termii does", () => {
    expect(nationalLengthForDial("234")).toEqual([10, 10]);
    expect(nationalLengthForDial("+234")).toEqual([10, 10]);
  });
});

describe("detecting a country from Cloudflare", () => {
  it("maps the codes for the countries being onboarded", async () => {
    const { countryFromIso2 } = await import("@/lib/country-profile");
    expect(countryFromIso2("MZ")).toBe("Mozambique");
    expect(countryFromIso2("NG")).toBe("Nigeria");
    expect(countryFromIso2("ke")).toBe("Kenya"); // case is not the caller's problem
  });

  it("returns null rather than guessing", async () => {
    /*
     * Cloudflare sends XX for an address it cannot place and T1 for Tor. A
     * guess here would quietly assert that somebody is somewhere they are not,
     * and set their currency to match.
     */
    const { countryFromIso2 } = await import("@/lib/country-profile");
    for (const bad of ["XX", "T1", "", "ZZZ", null, undefined]) {
      expect(countryFromIso2(bad as string | null)).toBeNull();
    }
  });

  it("only ever names a country the dropdown offers", async () => {
    const { countryFromIso2 } = await import("@/lib/country-profile");
    const codes = ["MZ", "NG", "KE", "FR", "PT", "BR", "ZA", "GH", "US", "GB"];
    for (const c of codes) {
      const name = countryFromIso2(c);
      expect(name, c).not.toBeNull();
      expect(COUNTRIES, c).toContain(name!);
    }
  });
});
