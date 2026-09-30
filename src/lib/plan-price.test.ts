import { describe, expect, it, vi } from "vitest";

/**
 * Pricing a plan for the church looking at it.
 *
 * The rate service is stubbed so these assert the decisions, not the market:
 * who carries the surcharge, who does not, and the cases where applying it
 * would be absurd.
 */

vi.mock("@/lib/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fx")>();
  return {
    ...actual,
    getRates: async () => ({
      perNgn: { USD: 1 / 1550, MZN: 1 / 24, EUR: 1 / 1650, KES: 1 / 10.25 },
      fetchedAt: "2026-09-30T00:00:00.000Z",
      live: true,
    }),
  };
});

const { priceForCountry, pricesForCountry, planPriceLabelFor, planAmountLabel } =
  await import("@/lib/plan-price");

describe("a Nigerian church", () => {
  it("pays the list price with nothing added", async () => {
    const p = await priceForCountry(5000, "Nigeria");
    expect(p.chargeNgn).toBe(5000);
    expect(p.surchargeNgn).toBe(0);
    expect(p.international).toBe(false);
    expect(p.displayCurrency).toBe("NGN");
  });

  it("is what an unknown country falls back to", async () => {
    // A Nigerian product's honest default when Cloudflare cannot place someone.
    for (const country of [null, undefined, ""]) {
      expect((await priceForCountry(5000, country)).international).toBe(false);
    }
  });
});

describe("a church outside Nigeria", () => {
  it("is charged more than the list price, and told in its own money", async () => {
    const p = await priceForCountry(5000, "Mozambique");
    expect(p.international).toBe(true);
    expect(p.chargeNgn).toBeGreaterThan(5000);
    expect(p.displayCurrency).toBe("MZN");
    expect(p.baseNgn).toBe(5000);
  });

  it("keeps the base price visible so the surcharge can be explained", async () => {
    // The page has to be able to say "₦15,000 plus ₦x card fee" rather than
    // showing a larger number with no account of where it came from.
    const p = await priceForCountry(15_000, "France");
    expect(p.baseNgn).toBe(15_000);
    expect(p.surchargeNgn).toBeGreaterThan(0);
    // Rounded up from base + surcharge, so never less than the two together.
    expect(p.chargeNgn).toBeGreaterThanOrEqual(p.baseNgn + p.surchargeNgn);
  });

  it("does not let rounding quietly swallow the surcharge", async () => {
    // Rounding the other way would hand back most of the fee on a small plan.
    const p = await priceForCountry(5000, "Mozambique");
    expect(p.chargeNgn - p.baseNgn).toBeGreaterThanOrEqual(p.surchargeNgn);
  });
});

describe("a free plan", () => {
  it("stays free everywhere", async () => {
    /*
     * The floor exists because a card fee on a tiny payment is most of the
     * payment. With no payment there is no fee, and applying the floor would
     * bill ₦5,000 for a zero-naira plan.
     */
    const p = await priceForCountry(0, "Mozambique");
    expect(p.chargeNgn).toBe(0);
    expect(p.international).toBe(false);
    expect(planPriceLabelFor(p)).toBe("Free");
  });
});

describe("pricing a whole table at once", () => {
  it("matches what pricing each plan separately would give", async () => {
    // Two code paths, one answer — or the page and the checkout disagree.
    const base = { starter: 0, growth: 5000, pro: 15_000, enterprise: null };
    const table = await pricesForCountry(base, "Mozambique");
    for (const [id, amount] of Object.entries(base)) {
      if (amount === null) {
        expect(table[id]).toBeNull();
        continue;
      }
      expect(table[id]).toEqual(await priceForCountry(amount, "Mozambique"));
    }
  });

  it("leaves a custom plan as null rather than pricing it at zero", async () => {
    const table = await pricesForCountry({ enterprise: null }, "Kenya");
    expect(table.enterprise).toBeNull();
  });
});

describe("plans stay distinguishable abroad", () => {
  it("does not collapse three plans onto one price", async () => {
    /*
     * A French visitor saw €50 on Growth, Pro AND Enterprise, because the
     * rounding step was a naira-sized 50 applied to single-digit euros. A
     * pricing table where every tier costs the same is not a pricing table.
     */
    const table = await pricesForCountry(
      { growth: 5000, pro: 10_000, enterprise: 25_000 },
      "France",
    );
    const shown = Object.values(table).map((p) => p!.displayAmount);
    expect(new Set(shown).size).toBe(3);
    expect(shown[0]).toBeLessThan(shown[1]);
    expect(shown[1]).toBeLessThan(shown[2]);
  });

  it("keeps the order of the tiers in every currency we sell in", async () => {
    for (const country of ["Mozambique", "Kenya", "France", "United States"]) {
      const t = await pricesForCountry({ a: 5000, b: 10_000, c: 25_000 }, country);
      expect(t.a!.displayAmount, country).toBeLessThan(t.b!.displayAmount);
      expect(t.b!.displayAmount, country).toBeLessThan(t.c!.displayAmount);
    }
  });
});

describe("labels", () => {
  it("shows whole units, because a subscription is a round number", async () => {
    expect(planAmountLabel(400, "MZN")).not.toContain(".00");
    expect(planAmountLabel(5000, "NGN")).not.toContain(".00");
  });

  it("still renders a currency Intl does not recognise", async () => {
    // Several smaller African codes are missing from older ICU data; a throw
    // here would take down the whole pricing page.
    expect(planAmountLabel(1000, "ZZZ")).toContain("1,000");
  });
});
