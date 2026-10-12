import { describe, expect, it } from "vitest";
import { churchMrr } from "@/lib/mrr";

const NOW = new Date("2026-10-12T12:00:00Z");
const DAY = 86_400_000;
const later = new Date(NOW.getTime() + 30 * DAY);
const earlier = new Date(NOW.getTime() - 30 * DAY);
const prices = { starter: 5000, growth: 10_000, pro: 25_000, enterprise: null };

describe("churchMrr", () => {
  it("is nothing for a church still in its free trial", () => {
    // The bug: every trial church counted at the Starter list price.
    expect(churchMrr({ plan: "starter", discountPct: 0, trialEndsAt: later }, null, prices, NOW)).toBe(0);
  });

  it("is nothing for a church whose trial ended unpaid", () => {
    expect(churchMrr({ plan: "starter", discountPct: 0, trialEndsAt: earlier }, null, prices, NOW)).toBe(0);
  });

  it("is nothing for a church whose paid plan lapsed", () => {
    expect(churchMrr({ plan: "growth", discountPct: 0, planRenewsAt: earlier }, null, prices, NOW)).toBe(0);
  });

  it("is nothing for a comped church", () => {
    expect(
      churchMrr({ plan: "pro", discountPct: 0, paymentWaived: true, planRenewsAt: later }, null, prices, NOW),
    ).toBe(0);
  });

  it("is nothing for a grandfathered church with no plan dates", () => {
    expect(churchMrr({ plan: "growth", discountPct: 0 }, null, prices, NOW)).toBe(0);
  });

  it("is nothing for a suspended church", () => {
    expect(
      churchMrr({ plan: "growth", discountPct: 0, planRenewsAt: later, status: "suspended" }, null, prices, NOW),
    ).toBe(0);
  });

  it("counts an annual payment as a twelfth, not as the monthly list price", () => {
    const v = churchMrr(
      { plan: "growth", discountPct: 0, planRenewsAt: later },
      { plan: "growth", amount: 100_000, periodMonths: 12 },
      prices,
      NOW,
    );
    expect(v).toBe(8333);
  });

  it("leaves the international card fee out of revenue", () => {
    const v = churchMrr(
      { plan: "growth", discountPct: 0, planRenewsAt: later },
      { plan: "growth", amount: 13_100, surchargeAmount: 3100, periodMonths: 1 },
      prices,
      NOW,
    );
    expect(v).toBe(10_000);
  });

  it("falls back to the discounted list price when no payment explains the plan", () => {
    expect(churchMrr({ plan: "pro", discountPct: 20, planRenewsAt: later }, null, prices, NOW)).toBe(20_000);
  });

  it("ignores a payment for a different plan than the current one", () => {
    const v = churchMrr(
      { plan: "pro", discountPct: 0, planRenewsAt: later },
      { plan: "starter", amount: 5000, periodMonths: 1 },
      prices,
      NOW,
    );
    expect(v).toBe(25_000);
  });
});
