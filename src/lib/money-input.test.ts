import { describe, expect, it } from "vitest";
import {
  MONEY_ERRORS,
  decimalSeparatorFor,
  parseMoney,
  parseMoneyInput,
} from "./money-input";

/*
 * Every one of these is a figure somebody types into a giving, finance or
 * pledge field. The failure this guards is silent: "1500,50" from a phone
 * whose decimal key is a comma used to be saved as 150050.
 */
describe("parseMoneyInput — what people actually type", () => {
  it.each([
    ["1500,50", 1500.5], // pt/fr keypad: the comma IS the decimal key
    ["500,5", 500.5],
    ["1,5", 1.5],
    ["2.500,00", 2500], // Portuguese grouping
    ["1.234,56", 1234.56],
    ["1 500,50", 1500.5], // French grouping with a space
    ["1 500,50", 1500.5], // ...and with the narrow no-break space
    ["1 500", 1500],
    ["1,500", 1500], // how every Nigerian church has always typed it
    ["1,500,000", 1500000],
    ["2.500.000", 2500000],
    ["1,500.50", 1500.5],
    ["1234.5", 1234.5],
    ["1500.", 1500],
    [".5", 0.5],
    [" 300 ", 300],
    ["NGN 750", 750],
    ["₦1,500", 1500],
    ["1.500,00 MT", 1500],
    ["999999999999", 999999999999],
  ])("%s -> %s", (raw, want) => {
    expect(parseMoneyInput(raw)).toEqual({ ok: true, value: want });
  });

  it("never multiplies a decimal-comma figure by 100", () => {
    for (const raw of ["1500,50", "500,00", "2.500,00", "1 500,50"]) {
      const v = parseMoney(raw)!;
      expect(v).toBeLessThan(3000);
    }
  });

  it("refuses what cannot be read one way only", () => {
    expect(parseMoneyInput("12,3456")).toEqual({
      ok: false,
      error: MONEY_ERRORS.ambiguous,
    });
    expect(parseMoneyInput("1,500,50").ok).toBe(false);
    expect(parseMoneyInput("1.50.0").ok).toBe(false);
    expect(parseMoneyInput("1,2.5").ok).toBe(false);
  });

  it("refuses a third decimal place instead of rounding it away", () => {
    expect(parseMoneyInput("1.234")).toEqual({
      ok: false,
      error: MONEY_ERRORS.tooPrecise,
    });
    expect(parseMoneyInput("10.555").ok).toBe(false);
  });

  it("refuses things that are not amounts", () => {
    for (const bad of ["", "   ", "abc", "-", ".", ",", "1e5", "12abc34"]) {
      expect(parseMoneyInput(bad).ok).toBe(false);
    }
    expect(parseMoneyInput(null).ok).toBe(false);
    expect(parseMoneyInput(undefined).ok).toBe(false);
  });

  it("zero and negatives only where the caller allows them", () => {
    expect(parseMoneyInput("0")).toEqual({ ok: false, error: MONEY_ERRORS.notPositive });
    expect(parseMoneyInput("-40")).toEqual({ ok: false, error: MONEY_ERRORS.negative });
    expect(parseMoneyInput("(200)")).toEqual({ ok: false, error: MONEY_ERRORS.negative });
    expect(parseMoneyInput("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(parseMoneyInput("-1.500,25", { allowNegative: true })).toEqual({
      ok: true,
      value: -1500.25,
    });
  });

  it("refuses an amount too large for numeric(14,2)", () => {
    expect(parseMoneyInput("1000000000000")).toEqual({
      ok: false,
      error: MONEY_ERRORS.tooLarge,
    });
  });

  it("takes a finite number as it is", () => {
    expect(parseMoneyInput(7500)).toEqual({ ok: true, value: 7500 });
    expect(parseMoneyInput(Number.NaN).ok).toBe(false);
  });
});

describe("the one ambiguous shape, settled by the church's convention", () => {
  it("a single separator before three digits", () => {
    // Lagos: grouping. Maputo: "5.000" is five thousand, "1,500" one and a half.
    expect(parseMoney("5.000")).toBeNull();
    expect(parseMoney("5.000", { decimal: "," })).toBe(5000);
    expect(parseMoney("1,500", { decimal: "." })).toBe(1500);
    expect(parseMoney("1,500", { decimal: "," })).toBeNull();
  });

  it("the hint never overrides an unambiguous figure", () => {
    expect(parseMoney("1500,50", { decimal: "." })).toBe(1500.5);
    expect(parseMoney("1,500.00", { decimal: "," })).toBe(1500);
  });

  it("knows who writes a decimal comma", () => {
    expect(decimalSeparatorFor("pt")).toBe(",");
    expect(decimalSeparatorFor("fr")).toBe(",");
    expect(decimalSeparatorFor("en", "Nigeria")).toBe(".");
    expect(decimalSeparatorFor("en", "Germany")).toBe(",");
  });
});
