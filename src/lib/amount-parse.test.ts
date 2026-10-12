import { describe, expect, it, vi } from "vitest";
import {
  amountLocaleForCurrency,
  decimalMarkForLocale,
  formatAmountInLocale,
  parseLocaleAmount,
  readAmount,
} from "@/lib/amount-parse";

describe("decimalMarkForLocale", () => {
  it("reads the mark from CLDR", () => {
    expect(decimalMarkForLocale("en")).toBe(".");
    expect(decimalMarkForLocale("en-NG")).toBe(".");
    expect(decimalMarkForLocale("pt")).toBe(",");
    expect(decimalMarkForLocale("pt-MZ")).toBe(",");
    expect(decimalMarkForLocale("fr")).toBe(",");
  });
});

describe("amountLocaleForCurrency", () => {
  it("finds the church's convention from its currency", () => {
    expect(amountLocaleForCurrency("NGN")).toBe("en");
    expect(amountLocaleForCurrency("MZN")).toBe("pt");
    expect(amountLocaleForCurrency("XOF")).toBe("fr");
    expect(amountLocaleForCurrency("usd")).toBe("en");
    expect(amountLocaleForCurrency("ZZZ")).toBe("en");
    expect(amountLocaleForCurrency(null)).toBe("en");
  });
});

describe("parseLocaleAmount under en-NG (what already worked keeps working)", () => {
  const en = "en-NG";
  it.each([
    ["1,500", 1500],
    ["2,000.50", 2000.5],
    ["NGN 750", 750],
    ["₦1,000,000", 1_000_000],
    ["7.5", 7.5],
    ["  250  ", 250],
    ["12,50", 12.5],
    ["0.500", 0.5],
    ["12500.000", 12500],
  ])("%s -> %s", (input, want) => {
    expect(parseLocaleAmount(input, en)).toBe(want);
  });

  it("keeps an English 5.000 as five, and says it guessed", () => {
    expect(readAmount("5.000", en)).toEqual({ value: 5, ambiguous: true });
    expect(readAmount("5,000", en)).toEqual({ value: 5000, ambiguous: true });
  });
});

describe("parseLocaleAmount under pt-MZ", () => {
  const pt = "pt-MZ";
  it("5.000 is five thousand meticais, not five", () => {
    expect(readAmount("5.000", pt)).toEqual({ value: 5000, ambiguous: true });
  });
  it.each([
    ["1.500,00", 1500],
    ["12,50", 12.5],
    ["MT 1.000.000", 1_000_000],
    ["1.234.567,89", 1234567.89],
  ])("%s -> %s", (input, want) => {
    expect(parseLocaleAmount(input, pt)).toBe(want);
  });
});

describe("parseLocaleAmount under fr", () => {
  const fr = "fr";
  it.each([
    ["5 000", 5000],
    ["5\u00a0000", 5000],
    ["5\u202f000,25", 5000.25],
    ["5,50", 5.5],
    ["5 000 FCFA", 5000],
  ])("%j -> %s", (input, want) => {
    expect(parseLocaleAmount(input, fr)).toBe(want);
  });
});

describe("parseLocaleAmount refuses what is not a gift", () => {
  it.each([
    "",
    "abc",
    "0",
    "0,00",
    "-500",
    "−500",
    "1.5.2",
    "1,000.000.5",
    "1.000,00,5",
    "1000000000000",
    ".",
    ",",
  ])("%j -> null", (input) => {
    expect(parseLocaleAmount(input, "en")).toBeNull();
    expect(parseLocaleAmount(input, "pt")).toBeNull();
  });

  it("rounds to two places rather than inventing kobo", () => {
    expect(parseLocaleAmount("10.005", "en")).toBe(10.01);
    expect(parseLocaleAmount("10.1234", "en")).toBe(10.12);
  });

  it("does not flag an unambiguous figure", () => {
    expect(readAmount("1,500.00", "en").ambiguous).toBe(false);
    expect(readAmount("1500", "pt").ambiguous).toBe(false);
  });
});

describe("a point that belongs to an abbreviation", () => {
  it.each([
    ["KSh. 500", "en", 500],
    ["Rs. 1,500", "en", 1500],
    ["KSh.500", "en", 500],
    ["MT. 1.500,00", "pt", 1500],
    // Not touching a letter, so it is still the number's own point.
    [".5", "en", 0.5],
    ["MT .50", "pt", 0.5],
  ])("%j (%s) -> %s", (input, locale, want) => {
    expect(parseLocaleAmount(input, locale)).toBe(want);
  });

  it("does not turn an abbreviation into a guess", () => {
    expect(readAmount("KSh. 500", "en").ambiguous).toBe(false);
  });
});

describe("formatAmountInLocale draws the echo in the convention it was read in", () => {
  it("a Maputo giver sees their own punctuation", () => {
    expect(formatAmountInLocale(5000, "MZN", "pt")).toBe("MT 5.000,00");
  });
  it("a Lagos giver sees the usual figure", () => {
    expect(formatAmountInLocale(5000, "NGN", "en")).toBe("₦5,000.00");
  });
  it("keeps the kobo even for a zero-decimal currency, as formatMoney does", () => {
    // What is sent is what is shown: 5000.5 must not be echoed as 5 001.
    expect(formatAmountInLocale(5000.5, "XOF", "fr")).toMatch(/^CFA 5\s000,50$/u);
  });
  it("falls back to formatMoney for a locale the runtime refuses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(formatAmountInLocale(5000, "NGN", "not a locale!")).toBe("₦5,000.00");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
