import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROFILE,
  SMS_COUNTRIES,
  countryProfile,
  currencyForCountry,
  knownCountries,
  localeForCountry,
  smsAvailableForCountry,
} from "@/lib/country-profile";
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

  it("starts an East African church in Swahili where that is the lingua franca", () => {
    expect(localeForCountry("Kenya")).toBe("sw");
    expect(localeForCountry("Tanzania")).toBe("sw");
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

describe("dial codes", () => {
  it("knows the codes for the countries we are onboarding first", () => {
    expect(countryProfile("Mozambique").dial).toBe("258");
    expect(countryProfile("Nigeria").dial).toBe("234");
    expect(countryProfile("Kenya").dial).toBe("254");
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
