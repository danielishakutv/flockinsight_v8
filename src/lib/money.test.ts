import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyCompact, formatMoneyPlain } from "./money";

/*
 * The point of these is not the exact characters — it is that they cannot
 * depend on the machine. A server in en-US and a phone in pt-MZ must draw the
 * same string, or React throws the server's page away on hydration.
 */
describe("money is drawn the same way on every machine", () => {
  it("naira, as a Nigerian church has always seen it", () => {
    expect(formatMoney(1500, "NGN")).toBe("₦1,500.00");
    expect(formatMoney(1234567.5, "NGN")).toBe("₦1,234,567.50");
  });

  it("a multi-letter symbol is spaced from the figure", () => {
    expect(formatMoney(1234567.5, "MZN")).toBe("MT 1,234,567.50");
    expect(formatMoney(2500, "KES")).toBe("KSh 2,500.00");
  });

  it("an unknown currency falls back to its code, not to naira", () => {
    expect(formatMoney(10, "XYZ")).toBe("XYZ 10.00");
  });

  it("negative amounts keep the sign in front of the symbol", () => {
    expect(formatMoney(-1500, "NGN")).toBe("-₦1,500.00");
  });

  it("does not print NaN or Infinity on a statement", () => {
    expect(formatMoney(Number.NaN, "NGN")).toBe("₦0.00");
    expect(formatMoney(Number.POSITIVE_INFINITY, "NGN")).toBe("₦0.00");
  });

  it("plain keeps kobo only when there are any", () => {
    expect(formatMoneyPlain(10000, "NGN")).toBe("₦10,000");
    expect(formatMoneyPlain(10000.5, "NGN")).toBe("₦10,000.50");
  });

  it("compact for stat cards", () => {
    expect(formatMoneyCompact(1_250_000, "NGN")).toBe("₦1.3M");
    expect(formatMoneyCompact(950, "NGN")).toBe("₦950");
  });

  it("ignores the runtime locale entirely", () => {
    const original = Intl.NumberFormat;
    // A runtime whose default locale is Portuguese.
    const pt = function (
      locales?: string | string[],
      options?: Intl.NumberFormatOptions,
    ) {
      return new original(locales ?? "pt-MZ", options);
    } as unknown as typeof Intl.NumberFormat;
    Intl.NumberFormat = pt;
    try {
      expect(formatMoney(1234567.5, "MZN")).toBe("MT 1,234,567.50");
    } finally {
      Intl.NumberFormat = original;
    }
  });
});
