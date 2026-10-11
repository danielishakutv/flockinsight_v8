import { describe, expect, it } from "vitest";
import {
  applyRate,
  canWithdraw,
  DEFAULT_PARTNER_RATES,
  earningFor,
  earningNote,
  earningsForPayment,
  generatePartnerCode,
  normalisePartnerCode,
  normaliseRates,
  otpBelongsToPartner,
  otpDestination,
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

describe("a payment that covers a whole year", () => {
  /*
   * The thing this file exists for. A church paying for a year makes ONE
   * payment, and before `earningsForPayment` that payment earned one
   * commission — the first — and the Partner then waited a year for the second
   * and never saw a month of trail. The Partner who closed the better deal was
   * paid a quarter of what the same church paying monthly would have paid
   * them.
   */
  const annual = 100_000; // ₦10,000/mo with two months free

  it("pays the first, the second and every month of trail at once", () => {
    const lines = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 1,
      months: 12,
    });

    expect(lines.map((l) => l.kind)).toEqual(["first", "second", "trail"]);

    const perMonth = annual / 12; // 8,333.33…
    expect(lines[0]).toMatchObject({ months: 1, fromMonth: 1, toMonth: 1, rateBps: 4000 });
    expect(lines[0].amount).toBe(applyRate(perMonth, 4000));
    expect(lines[1]).toMatchObject({ months: 1, fromMonth: 2, toMonth: 2, rateBps: 4000 });
    // Months 3–12: ten months of trail, in one row, rounded once.
    expect(lines[2]).toMatchObject({
      kind: "trail",
      months: 10,
      fromMonth: 3,
      toMonth: 12,
      rateBps: 500,
    });
    expect(lines[2].amount).toBe(applyRate(perMonth * 10, 500));
  });

  it("pays the Partner the same share of revenue either way", () => {
    // The whole fairness claim, as arithmetic. A year bought monthly at
    // ₦10,000 and the same year bought annually at ₦100,000 must earn the
    // same PROPORTION — the Partner neither profits from the church's
    // discount nor pays for it.
    const monthlyRun = Array.from({ length: 12 }, (_, i) =>
      earningFor({ rates, tier: base, amount: 10_000, paymentNumber: i + 1 }),
    );
    const monthlyEarned = monthlyRun.reduce((sum, e) => sum + (e?.amount ?? 0), 0);
    const monthlyRevenue = 120_000;

    const annualEarned = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 1,
      months: 12,
    }).reduce((sum, l) => sum + l.amount, 0);

    const shareMonthly = monthlyEarned / monthlyRevenue;
    const shareAnnual = annualEarned / annual;
    expect(shareAnnual).toBeCloseTo(shareMonthly, 6);
  });

  it("is neither of the two things a single payment could have meant", () => {
    /*
     * Both of the obvious readings of an annual payment are wrong, in opposite
     * directions, and this is the test that pins the rule down.
     *
     * Treating it as ONE payment pays 40% of the whole year — ₦40,000 of a
     * ₦100,000 payment — which is four times what the same church paying
     * monthly earns its Partner, and is the commission bill that would make
     * annual billing unprofitable to sell.
     *
     * Treating it as the first payment ONLY, and then waiting for the church
     * to pay again, pays the Partner for one month out of twelve and lets the
     * trail window expire unused.
     *
     * The rule is the middle one, and it is the only one that does not depend
     * on how the church chose to pay: twelve monthly commissions, paid now.
     */
    const asOnePayment = earningFor({
      rates,
      tier: base,
      amount: annual,
      paymentNumber: 1,
    })!;
    expect(asOnePayment.amount).toBe(40_000);

    const monthlyRun = Array.from({ length: 12 }, (_, i) =>
      earningFor({ rates, tier: base, amount: 10_000, paymentNumber: i + 1 }),
    ).reduce((sum, e) => sum + (e?.amount ?? 0), 0);

    const now = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 1,
      months: 12,
    }).reduce((sum, l) => sum + l.amount, 0);

    expect(now).toBeCloseTo(10_833.33, 2);
    expect(now).toBeLessThan(asOnePayment.amount);
    // The same share of revenue as the twelve-month monthly run: ₦13,000 of
    // ₦120,000 there, ₦10,833 of ₦100,000 here.
    expect(monthlyRun).toBe(13_000);
    expect(now / annual).toBeCloseTo(monthlyRun / 120_000, 6);
  });

  it("carries on from where a monthly church left off", () => {
    // Paid once monthly, then upgraded to a year: month 1 is spent, so the
    // year covers months 2–13 and the second commission is earned now.
    const lines = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 2,
      months: 12,
    });
    expect(lines.map((l) => l.kind)).toEqual(["second", "trail"]);
    expect(lines[1]).toMatchObject({ months: 11, fromMonth: 3, toMonth: 13 });
  });

  it("stops at the end of the trail window, not at the end of the year", () => {
    // A second annual payment covers months 13–24. The trail runs for twelve
    // months after the first two, so only 13 and 14 are inside it.
    const lines = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 13,
      months: 12,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "trail", months: 2, fromMonth: 13, toMonth: 14 });
  });

  it("earns nothing once the whole year is past the window", () => {
    expect(
      earningsForPayment({
        rates,
        tier: base,
        amount: annual,
        firstMonth: 25,
        months: 12,
      }),
    ).toEqual([]);
  });

  it("earns nothing from a payment of nothing", () => {
    // A free activation or a 100% discount is recorded as a successful
    // payment of zero. It must not consume the first commission.
    expect(
      earningsForPayment({ rates, tier: base, amount: 0, firstMonth: 1, months: 12 }),
    ).toEqual([]);
  });

  it("refuses a month number that makes no sense", () => {
    expect(
      earningsForPayment({ rates, tier: base, amount: annual, firstMonth: 0, months: 12 }),
    ).toEqual([]);
    expect(
      earningsForPayment({ rates, tier: base, amount: annual, firstMonth: NaN, months: 12 }),
    ).toEqual([]);
  });

  it("treats a payment with no stated period as one month", () => {
    const lines = earningsForPayment({
      rates,
      tier: base,
      amount: 10_000,
      firstMonth: 1,
      months: 0,
    });
    expect(lines).toEqual([
      {
        kind: "first",
        amount: 4000,
        rateBps: 4000,
        months: 1,
        fromMonth: 1,
        toMonth: 1,
      },
    ]);
  });

  it("explains itself on the ledger, and says nothing for a monthly payment", () => {
    const [, , trail] = earningsForPayment({
      rates,
      tier: base,
      amount: annual,
      firstMonth: 1,
      months: 12,
    });
    expect(earningNote(trail, 12)).toBe("months 3–12 of a 12-month payment · 10 × 5%");
    expect(earningNote(trail, 1)).toBeNull();
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

  /*
   * A row claimed by an open withdrawal keeps the status "available" until
   * that payout is marked paid. Counting it as available showed a Partner
   * money they had already asked for, and the figure did not move when they
   * pressed the button.
   */
  it("moves money inside an open request out of available", () => {
    const t = walletTotals([
      { amount: 10_000, status: "available", payoutId: "p1" },
      { amount: 5000, status: "available", payoutId: null },
      { amount: 3000, status: "pending" },
    ]);
    expect(t.available).toBe(5000);
    expect(t.requested).toBe(10_000);
    expect(t.pending).toBe(3000);
    // Still theirs, so it still counts towards what they have ever earned.
    expect(t.lifetime).toBe(18_000);
  });

  it("does not count a paid row twice once its payout is settled", () => {
    // After a payout is marked paid the rows become `paid` and keep the id.
    const t = walletTotals([{ amount: 10_000, status: "paid", payoutId: "p1" }]);
    expect(t.requested).toBe(0);
    expect(t.available).toBe(0);
    expect(t.paid).toBe(10_000);
    expect(t.lifetime).toBe(10_000);
  });

  it("treats a missing payoutId as unclaimed", () => {
    // Callers that do not select the column must not lose their balance.
    const t = walletTotals([{ amount: 2000, status: "available" }]);
    expect(t.available).toBe(2000);
    expect(t.requested).toBe(0);
  });

  it("is zero for a Partner who has earned nothing", () => {
    expect(walletTotals([])).toEqual({
      available: 0,
      requested: 0,
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

/* ============================================================
 * Proving a verification code is this Partner's
 * ========================================================== */

describe("otpBelongsToPartner", () => {
  /*
   * This is a security rule on a money path: email and phone verification are
   * two of the gates on withdrawing. Each case below is a hole that was open
   * in the first version of the Partner module, found by a review of the
   * pushed commit.
   */
  const good = {
    which: "phone" as const,
    partnerId: "p-1",
    expectedDestination: "08012345678",
    stored: {
      purpose: "partner_phone",
      destination: "08012345678",
      payload: { partnerId: "p-1", which: "phone", destination: "08012345678" },
    },
  };

  it("accepts the Partner's own code for the field it was sent for", () => {
    expect(otpBelongsToPartner(good)).toBe(true);
  });

  it("refuses a code issued for a different purpose", () => {
    /*
     * THE HOLE. `verifyOtp` only checks that the code matches the row, so
     * without this a Partner could take the code from their own EMAIL
     * verification — which they legitimately receive — and submit it as
     * `which: "phone"`, marking a number verified that was never texted.
     */
    expect(
      otpBelongsToPartner({
        ...good,
        stored: { ...good.stored, purpose: "partner_email" },
      }),
    ).toBe(false);

    // And any other OTP in the platform, for the same reason.
    expect(
      otpBelongsToPartner({
        ...good,
        stored: { ...good.stored, purpose: "church_contact_phone" },
      }),
    ).toBe(false);
  });

  it("refuses another Partner's code", () => {
    expect(
      otpBelongsToPartner({
        ...good,
        stored: {
          ...good.stored,
          payload: { partnerId: "p-2", which: "phone" },
        },
      }),
    ).toBe(false);
  });

  it("refuses a code with no owner recorded on it", () => {
    // An older code, from before the payload was written. It must fail closed.
    expect(
      otpBelongsToPartner({ ...good, stored: { ...good.stored, payload: null } }),
    ).toBe(false);
  });

  it("refuses a code sent to a different number", () => {
    /*
     * Otherwise: request a code to a number you control, change the number on
     * your profile, then verify the NEW one with the OLD code.
     */
    expect(
      otpBelongsToPartner({
        ...good,
        stored: { ...good.stored, destination: "08099999999" },
      }),
    ).toBe(false);
  });

  it("refuses when the Partner has no number or address to compare", () => {
    expect(otpBelongsToPartner({ ...good, expectedDestination: "" })).toBe(false);
  });
});

describe("otpDestination", () => {
  it("lowercases and trims an email, so case cannot fail a real match", () => {
    expect(otpDestination("email", "  Pastor@Grace.NG ")).toBe("pastor@grace.ng");
  });

  it("strips the punctuation people type into a phone number", () => {
    expect(otpDestination("phone", "+234 (801) 234-5678")).toBe("+2348012345678");
    expect(otpDestination("phone", "0801 234 5678")).toBe("08012345678");
  });
});
