import { describe, expect, it } from "vitest";
import {
  INTERNATIONAL_FLOOR_NGN,
  INTERNATIONAL_SURCHARGE_USD,
  internationalPrice,
  rateFor,
  roundUpPrice,
  type Rates,
} from "@/lib/fx";

/**
 * What an international church is charged. The cases that matter are the ones
 * where a rounding or a missing rate would quietly sell below cost.
 */

const rates: Rates = {
  perNgn: { USD: 1 / 1550, MZN: 1 / 24, EUR: 1 / 1650, KES: 1 / 12 },
  fetchedAt: "2026-09-30T00:00:00.000Z",
  live: true,
};

describe("roundUpPrice", () => {
  it("always rounds up, never down", () => {
    // Rounding down would eat the surcharge the rounding exists to protect.
    expect(roundUpPrice(7431.88)).toBeGreaterThanOrEqual(7431.88);
    expect(roundUpPrice(101)).toBeGreaterThanOrEqual(101);
    expect(roundUpPrice(10_001)).toBeGreaterThanOrEqual(10_001);
  });

  it("lands on a number that reads like a price", () => {
    expect(roundUpPrice(7431.88) % 100).toBe(0);
    expect(roundUpPrice(120) % 50).toBe(0);
  });

  it("is zero for nothing", () => {
    expect(roundUpPrice(0)).toBe(0);
    expect(roundUpPrice(-5)).toBe(0);
  });
});

describe("internationalPrice", () => {
  it("adds the surcharge on top of the base price", () => {
    const p = internationalPrice(5000, "MZN", rates);
    const surchargeInNgn = INTERNATIONAL_SURCHARGE_USD * 1550;
    expect(p.chargeNgn).toBeGreaterThanOrEqual(5000 + surchargeInNgn);
  });

  it("never charges less than the floor", () => {
    // Below it the card fee is a large fraction of the payment.
    const p = internationalPrice(500, "MZN", rates);
    expect(p.chargeNgn).toBeGreaterThanOrEqual(INTERNATIONAL_FLOOR_NGN);
  });

  it("shows a Mozambican church meticais, not naira", () => {
    const p = internationalPrice(5000, "MZN", rates);
    expect(p.displayCurrency).toBe("MZN");
    expect(p.displayAmount).toBeGreaterThan(0);
    // 8,100 naira at 24 NGN to the metical is a few hundred MT, not thousands.
    expect(p.displayAmount).toBeLessThan(p.chargeNgn);
  });

  it("falls back to naira rather than inventing a conversion", () => {
    // An honest foreign number beats a confident wrong one.
    const p = internationalPrice(5000, "XYZ", rates);
    expect(p.displayCurrency).toBe("NGN");
    expect(p.displayAmount).toBe(p.chargeNgn);
  });

  it("carries through that a price came from the fallback table", () => {
    const stale = { ...rates, live: false };
    expect(internationalPrice(5000, "MZN", stale).live).toBe(false);
    expect(internationalPrice(5000, "MZN", rates).live).toBe(true);
  });

  it("itemises the surcharge so the page can explain it", () => {
    const p = internationalPrice(15_000, "EUR", rates);
    expect(p.surchargeNgn).toBeGreaterThan(0);
    expect(p.surchargeNgn).toBeLessThan(p.chargeNgn);
  });

  it("scales with the plan rather than flattening every price", () => {
    const small = internationalPrice(5000, "KES", rates);
    const large = internationalPrice(15_000, "KES", rates);
    expect(large.chargeNgn).toBeGreaterThan(small.chargeNgn);
  });
});

describe("rateFor", () => {
  it("is null for a currency we have no rate for", () => {
    expect(rateFor(rates, "XYZ")).toBeNull();
  });

  it("ignores case", () => {
    expect(rateFor(rates, "mzn")).toBe(rateFor(rates, "MZN"));
  });

  it("rejects a nonsense rate rather than dividing by it", () => {
    const broken: Rates = { ...rates, perNgn: { BAD: 0 } };
    expect(rateFor(broken, "BAD")).toBeNull();
  });
});
