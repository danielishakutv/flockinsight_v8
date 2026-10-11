import { describe, expect, it } from "vitest";
import {
  annualDiscountPct,
  annualSaving,
  annualTotal,
  asCycle,
  chargedMonths,
  cycleMonths,
  cycleTotal,
  DEFAULT_ANNUAL_FREE_MONTHS,
  freeMonthsLabel,
  monthlyEquivalent,
  normaliseFreeMonths,
} from "@/lib/billing-cycle";

/**
 * The annual price is a charge, so it is tested like one.
 *
 * The case worth reading twice is the last block: the yearly total must come
 * out of a whole number of months and never out of the rounded percentage the
 * badge shows, or the pricing page and the invoice stop agreeing.
 */

describe("the cycle a church chose", () => {
  it("only ever means one of two things", () => {
    expect(asCycle("annual")).toBe("annual");
    expect(asCycle("monthly")).toBe("monthly");
  });

  it("treats anything else as monthly rather than throwing", () => {
    expect(asCycle("yearly")).toBe("monthly");
    expect(asCycle(undefined)).toBe("monthly");
    expect(asCycle(12)).toBe("monthly");
  });

  it("buys twelve months of service, or one", () => {
    expect(cycleMonths("annual")).toBe(12);
    expect(cycleMonths("monthly")).toBe(1);
  });
});

describe("the months-free setting", () => {
  it("defaults to two", () => {
    expect(DEFAULT_ANNUAL_FREE_MONTHS).toBe(2);
    expect(normaliseFreeMonths(undefined)).toBe(2);
    expect(normaliseFreeMonths("not a number")).toBe(2);
  });

  it("refuses to give the whole year away by typo", () => {
    // 12 free months out of 12 is a free plan reached by accident.
    expect(normaliseFreeMonths(12)).toBe(11);
    expect(normaliseFreeMonths(99)).toBe(11);
  });

  it("allows the offer to be switched off", () => {
    expect(normaliseFreeMonths(0)).toBe(0);
    expect(chargedMonths(0)).toBe(12);
    expect(annualTotal(10_000, 0)).toBe(120_000);
  });

  it("never charges a negative number of months", () => {
    expect(normaliseFreeMonths(-5)).toBe(0);
  });

  it("charges ten months for a year, by default", () => {
    expect(chargedMonths(2)).toBe(10);
  });
});

describe("what a year costs", () => {
  it("is ten months of money for twelve months of service", () => {
    expect(annualTotal(10_000, 2)).toBe(100_000);
    expect(annualTotal(25_000, 2)).toBe(250_000);
    expect(annualTotal(5_000, 2)).toBe(50_000);
  });

  it("leaves a custom plan custom", () => {
    expect(annualTotal(null, 2)).toBeNull();
    expect(cycleTotal(null, "monthly", 2)).toBeNull();
    expect(monthlyEquivalent(null, 2)).toBeNull();
  });

  it("charges the list price monthly", () => {
    expect(cycleTotal(10_000, "monthly", 2)).toBe(10_000);
  });

  it("says what the church keeps", () => {
    expect(annualSaving(10_000, 2)).toBe(20_000);
    expect(annualSaving(0, 2)).toBe(0);
    expect(annualSaving(null, 2)).toBe(0);
  });

  it("works the yearly total back to a monthly figure", () => {
    // 100,000 / 12 = 8,333.33 → a round number, because every price here is.
    expect(monthlyEquivalent(10_000, 2)).toBe(8_333);
    expect(monthlyEquivalent(25_000, 2)).toBe(20_833);
  });

  it("names the offer the way a person would", () => {
    expect(freeMonthsLabel(2)).toBe("2 months free");
    expect(freeMonthsLabel(1)).toBe("1 month free");
  });
});

describe("the badge percentage never decides money", () => {
  it("rounds for display", () => {
    expect(annualDiscountPct(2)).toBe(17); // 16.666…
    expect(annualDiscountPct(1)).toBe(8); // 8.333…
    expect(annualDiscountPct(3)).toBe(25);
  });

  it("and the charge disagrees with it, which is why it is not used", () => {
    const monthly = 10_000;
    const fromMonths = annualTotal(monthly, 2)!;
    const fromBadge = Math.round(
      monthly * 12 * (1 - annualDiscountPct(2) / 100),
    );
    expect(fromMonths).toBe(100_000);
    expect(fromBadge).toBe(99_600); // ₦400 adrift, from a rounded percentage
    expect(fromMonths).not.toBe(fromBadge);
  });
});
