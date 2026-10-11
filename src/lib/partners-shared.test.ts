import { describe, expect, it } from "vitest";
import {
  applyRate,
  canWithdraw,
  DEFAULT_PARTNER_RATES,
  earningFor,
  generatePartnerCode,
  normalisePartnerCode,
  normaliseRates,
  nextTier,
  partnerLink,
  tierFor,
  walletTotals,
  type PartnerRates,
} from "@/lib/partners-shared";

/**
 * This is the money, so it is tested like money.
 *
 * Every case here is a sum somebody is counting on. The ones worth reading
 * twice are the idempotence-adjacent ones — the second commission only being
 * earned on the second payment, and the trail not being paid on top of it —
 * because those are the two mistakes that pay an agent twice for one event.
 */

const rates = DEFAULT_PARTNER_RATES;
const base = rates.tiers[0];

describe("applyRate", () => {
  it("takes 40% as four thousand basis points", () => {
    expect(applyRate(25_000, 4000)).toBe(10_000);
  });

  it("rounds to the minor unit, once", () => {
    // 4999 * 45% = 2249.55
    expect(applyRate(4999, 4500)).toBe(2249.55);
  });

  it("earns nothing from nothing", () => {
    expect(applyRate(0, 4000)).toBe(0);
    expect(applyRate(-5000, 4000)).toBe(0);
    expect(applyRate(25_000, 0)).toBe(0);
  });
});

describe("what a payment earns", () => {
  it("pays the first-payment rate on the first payment", () => {
    const e = earningFor({ rates, tier: base, amount: 25_000, paymentNumber: 1 });
    expect(e).toEqual({ kind: "first", amount: 10_000, rateBps: 4000 });
  });

  it("pays the second-payment rate on the second, and only then", () => {
    /*
     * The rule that matters most. The second commission is not held back and
     * then released — it simply is not earned until the church's second
     * payment actually clears, which removes the incentive to sign a church
     * that cannot pay.
     */
    const e = earningFor({ rates, tier: base, amount: 25_000, paymentNumber: 2 });
    expect(e).toEqual({ kind: "second", amount: 10_000, rateBps: 4000 });
  });

  it("starts the trail at the third payment, not on top of the second", () => {
    // Paying both on one payment would be paying twice for one event.
    const third = earningFor({ rates, tier: base, amount: 25_000, paymentNumber: 3 });
    expect(third).toEqual({ kind: "trail", amount: 1250, rateBps: 500 });
  });

  it("runs the trail for exactly as many payments as configured", () => {
    const last = earningFor({
      rates,
      tier: base,
      amount: 25_000,
      paymentNumber: 2 + rates.trailMonths,
    });
    expect(last?.kind).toBe("trail");

    const after = earningFor({
      rates,
      tier: base,
      amount: 25_000,
      paymentNumber: 3 + rates.trailMonths,
    });
    expect(after).toBeNull();
  });

  it("pays the tier's rate, not the base rate", () => {
    const lead = rates.tiers.find((t) => t.name === "Lead Partner");
    expect(lead).toBeTruthy();
    const e = earningFor({
      rates,
      tier: lead!,
      amount: 25_000,
      paymentNumber: 1,
    });
    expect(e).toEqual({ kind: "first", amount: 12_500, rateBps: 5000 });
  });

  it("pays nothing with the trail turned off", () => {
    const off: PartnerRates = { ...rates, trailBps: 0 };
    expect(earningFor({ rates: off, tier: base, amount: 25_000, paymentNumber: 3 })).toBeNull();
  });

  it("refuses a payment number that makes no sense", () => {
    expect(earningFor({ rates, tier: base, amount: 1000, paymentNumber: 0 })).toBeNull();
    expect(
      earningFor({ rates, tier: base, amount: 1000, paymentNumber: NaN }),
    ).toBeNull();
  });
});

describe("the tier a Partner is on", () => {
  it("starts everybody at the bottom", () => {
    expect(tierFor(rates, 0).name).toBe("Partner");
    expect(tierFor(rates, 4).name).toBe("Partner");
  });

  it("climbs on churches live and paying", () => {
    expect(tierFor(rates, 5).name).toBe("Senior Partner");
    expect(tierFor(rates, 14).name).toBe("Senior Partner");
    expect(tierFor(rates, 15).name).toBe("Lead Partner");
    expect(tierFor(rates, 400).name).toBe("Regional Partner");
  });

  it("honours an override, because some arrangements a rule cannot see", () => {
    expect(tierFor(rates, 0, "Lead Partner").name).toBe("Lead Partner");
  });

  it("ignores an override that names no real tier", () => {
    expect(tierFor(rates, 0, "Supreme Chancellor").name).toBe("Partner");
  });

  it("says what the next rung costs", () => {
    expect(nextTier(rates, 3)).toEqual({ tier: rates.tiers[1], needed: 2 });
    expect(nextTier(rates, 500)).toBeNull();
  });
});

describe("the wallet", () => {
  it("keeps available, pending and paid apart, and they add up", () => {
    const t = walletTotals([
      { amount: 10_000, status: "available" },
      { amount: 2500.5, status: "available" },
      { amount: 7000, status: "pending" },
      { amount: 40_000, status: "paid" },
      { amount: 9999, status: "cancelled" },
    ]);
    expect(t.available).toBe(12_500.5);
    expect(t.pending).toBe(7000);
    expect(t.paid).toBe(40_000);
    // Cancelled counts towards nothing, and is kept only so the ledger can
    // still explain itself.
    expect(t.lifetime).toBe(59_500.5);
  });

  it("is zero for a Partner who has earned nothing", () => {
    expect(walletTotals([])).toEqual({
      available: 0,
      pending: 0,
      paid: 0,
      lifetime: 0,
    });
  });
});

describe("whether a withdrawal may go ahead", () => {
  const ok = {
    rates,
    available: 50_000,
    amount: 20_000,
    status: "active" as const,
    hasBank: true,
    emailVerified: true,
    phoneVerified: true,
    openRequest: false,
  };

  it("allows a complete, funded request", () => {
    expect(canWithdraw(ok)).toEqual({ ok: true });
  });

  it("refuses below the minimum, and names it", () => {
    const r = canWithdraw({ ...ok, amount: 9999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("10,000");
  });

  it("refuses more than is available", () => {
    const r = canWithdraw({ ...ok, amount: 60_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/available balance/i);
  });

  it("refuses without bank details", () => {
    expect(canWithdraw({ ...ok, hasBank: false }).ok).toBe(false);
  });

  it("refuses until the email and phone are verified", () => {
    /*
     * A payout goes to a person we actually reached. Verifying after the money
     * has gone is the wrong order.
     */
    expect(canWithdraw({ ...ok, emailVerified: false }).ok).toBe(false);
    expect(canWithdraw({ ...ok, phoneVerified: false }).ok).toBe(false);
  });

  it("refuses a second request while one is in flight", () => {
    const r = canWithdraw({ ...ok, openRequest: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already have a withdrawal/i);
  });

  it("refuses an account that is not active, and says which", () => {
    const pending = canWithdraw({ ...ok, status: "pending" });
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.reason).toMatch(/being approved/i);

    const suspended = canWithdraw({ ...ok, status: "suspended" });
    expect(suspended.ok).toBe(false);
    if (!suspended.ok) expect(suspended.reason).toMatch(/suspended/i);
  });
});

describe("rates that arrive from storage", () => {
  it("falls back to the shipped ladder for nonsense", () => {
    expect(normaliseRates(null)).toEqual(DEFAULT_PARTNER_RATES);
    expect(normaliseRates("40%")).toEqual(DEFAULT_PARTNER_RATES);
    expect(normaliseRates({ tiers: [] }).tiers).toEqual(DEFAULT_PARTNER_RATES.tiers);
  });

  it("clamps a rate nobody meant to type", () => {
    /*
     * 40000 basis points is 400%, which would pay an agent four times what the
     * church paid us. A superadmin typing an extra zero must not be able to do
     * that.
     */
    const r = normaliseRates({
      tiers: [{ name: "Partner", minChurches: 0, firstBps: 40_000, secondBps: -5 }],
      trailBps: 99_999,
      minPayout: -1,
    });
    expect(r.tiers[0].firstBps).toBe(10_000);
    expect(r.tiers[0].secondBps).toBe(0);
    expect(r.trailBps).toBe(10_000);
    expect(r.minPayout).toBe(0);
  });

  it("sorts the ladder so the tier search is monotonic", () => {
    const r = normaliseRates({
      tiers: [
        { name: "Lead", minChurches: 15, firstBps: 5000, secondBps: 5000 },
        { name: "Base", minChurches: 0, firstBps: 4000, secondBps: 4000 },
      ],
    });
    expect(r.tiers.map((t) => t.minChurches)).toEqual([0, 15]);
    expect(tierFor(r, 20).name).toBe("Lead");
  });
});

describe("the code in the link", () => {
  it("avoids every character that sounds like another one", () => {
    // Read down a phone line to a pastor in a hurry.
    const code = generatePartnerCode(() => 0.5);
    expect(code).toHaveLength(6);
    expect(code).not.toMatch(/[aeiou01ilsz]/i);
  });

  it("accepts what somebody actually types", () => {
    expect(normalisePartnerCode("  BC-3K 9M  ")).toBe("bc3k9m");
  });

  it("builds a link a church can follow", () => {
    expect(partnerLink("https://flockinsight.com/", "bc3k9m")).toBe(
      "https://flockinsight.com/signup?ref=bc3k9m",
    );
  });
});
