import { describe, expect, it, vi } from "vitest";

/**
 * The trial gate, the billing page and the checkout price one plan the same
 * way. The bug: the gate printed the undiscounted Nigerian list price in
 * naira, and the button under it charged the discounted, converted total with
 * the international card fee — a different number, in a different currency.
 *
 * Settings and rates are stubbed: this asserts that the three surfaces agree,
 * not what the market is doing.
 */

vi.mock("@/lib/platform-settings", () => ({
  // No overrides stored: every price is the built-in default from plans.ts.
  getSetting: async (_key: string, fallback: string) => fallback,
  setSetting: async () => {},
}));

vi.mock("@/lib/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fx")>();
  return {
    ...actual,
    getRates: async () => ({
      perNgn: { USD: 1 / 1550, MZN: 1 / 24, KES: 1 / 12 },
      fetchedAt: "2026-10-01T00:00:00.000Z",
      live: true,
    }),
  };
});

const { chargeFor, gateOffers, priceBook, tierOffers } = await import("@/lib/plan-offers");
const { planPriceLabelFor } = await import("@/lib/plan-price");

const mozambique = { country: "Mozambique", planDiscountPct: 0 };
const discountedNigeria = { country: "Nigeria", planDiscountPct: 50 };

describe("the gate quotes what checkout charges", () => {
  it("for a church abroad: its own money, with the card fee, monthly and yearly", async () => {
    const { offers, note } = await gateOffers(mozambique, await tierOffers());
    const growth = offers.find((o) => o.id === "growth")!;
    const monthly = (await chargeFor("growth", "monthly", mozambique))!;
    const annual = (await chargeFor("growth", "annual", mozambique))!;

    expect(growth.priceLabel).toBe(planPriceLabelFor(monthly.priced, { perMonth: "/mo" }));
    expect(growth.annualPriceLabel).toBe(planPriceLabelFor(annual.priced, { perMonth: "/yr" }));
    expect(monthly.priced.displayCurrency).toBe("MZN");
    expect(monthly.priced.chargeNgn).toBe(monthly.total + monthly.priced.surchargeNgn);
    // And the gate says why the figure is more than the Nigerian price.
    expect(note).toContain("MZN");
    expect(note).toContain(`₦${monthly.priced.surchargeNgn.toLocaleString()}`);
  });

  it("for a discounted church at home: the discounted naira price, no note", async () => {
    const { offers, note } = await gateOffers(discountedNigeria, await tierOffers());
    const pro = offers.find((o) => o.id === "pro")!;
    const charge = (await chargeFor("pro", "monthly", discountedNigeria))!;
    expect(charge.priced.chargeNgn).toBe(charge.total);
    expect(pro.priceLabel).toBe(planPriceLabelFor(charge.priced, { perMonth: "/mo" }));
    expect(note).toBeNull();
  });

  it("offers 'Activate' rather than 'Pay' when a 100% discount makes it free", async () => {
    const { offers } = await gateOffers({ country: "Nigeria", planDiscountPct: 100 }, await tierOffers());
    expect(offers.every((o) => o.free)).toBe(true);
  });
});

describe("priceBook", () => {
  it("strikes through a 'was' price in the same money as the price", async () => {
    const book = await priceBook({ country: "Kenya", planDiscountPct: 20 }, await tierOffers());
    const now = book.local.monthly.growth!;
    const was = book.local.baseMonthly.growth!;
    expect(was.displayCurrency).toBe(now.displayCurrency);
    // Same fee on both, so the gap between them is the discount and nothing else.
    expect(was.chargeNgn - now.chargeNgn).toBe(was.baseNgn - now.baseNgn);
  });
});
