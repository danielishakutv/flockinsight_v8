import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildCostReport,
  gatewayFee,
  itemCostInMonth,
  meetingBillUsd,
  monthOf,
  monthRange,
  monthlyChurn,
  monthlyEquivalent,
  paymentShares,
  payingMonths,
  paystackFeeEstimate,
  shareOut,
  termiiSpendByMonth,
  type ChurchInput,
  type CostInputs,
  type CostItemInput,
  type PaymentInput,
} from "./cost-to-serve-shared";

describe("months", () => {
  it("reads a moment in Lagos time, where 23:30 UTC on the 31st is already the 1st", () => {
    expect(monthOf(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10");
  });

  it("adds and ranges across a year end", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange("2026-05", "2026-04")).toEqual([]);
  });
});

const item = (over: Partial<CostItemInput> = {}): CostItemInput => ({
  id: "i1",
  name: "VPS",
  category: "hosting",
  amountNgn: 30_000,
  foreign: false,
  frequency: "monthly",
  startsOn: "2026-01-01",
  endsOn: null,
  spreadMonths: null,
  driver: "active_churches",
  channel: null,
  ...over,
});

describe("an entered cost in a month", () => {
  it("counts a monthly bill whole in every month it is live", () => {
    expect(itemCostInMonth(item(), "2026-03")).toBe(30_000);
    expect(itemCostInMonth(item(), "2025-12")).toBe(0);
  });

  it("spreads a yearly bill as a twelfth a month, not a lump in the month it was paid", () => {
    const domain = item({ amountNgn: 24_000, frequency: "yearly" });
    expect(itemCostInMonth(domain, "2026-01")).toBe(2_000);
    expect(itemCostInMonth(domain, "2026-09")).toBe(2_000);
    expect(monthlyEquivalent(24_000, "yearly")).toBe(2_000);
    expect(monthlyEquivalent(9_000, "quarterly")).toBe(3_000);
  });

  it("counts only the days a bill was live in the month it starts or ends", () => {
    // 16th to 30th of a 30-day month is 15 days: half.
    expect(itemCostInMonth(item({ startsOn: "2026-06-16" }), "2026-06")).toBe(15_000);
    // Ended on the 10th of a 31-day month.
    expect(itemCostInMonth(item({ endsOn: "2026-07-10" }), "2026-07")).toBeCloseTo((30_000 * 10) / 31);
    expect(itemCostInMonth(item({ endsOn: "2026-07-10" }), "2026-08")).toBe(0);
  });

  it("lands a one-off whole in its month, or spread across the months asked for", () => {
    const flyer = item({ frequency: "one_off", amountNgn: 50_000, startsOn: "2026-04-20" });
    expect(itemCostInMonth(flyer, "2026-04")).toBe(50_000);
    expect(itemCostInMonth(flyer, "2026-05")).toBe(0);
    const laptop = item({ frequency: "one_off", amountNgn: 600_000, startsOn: "2026-04-20", spreadMonths: 24 });
    expect(itemCostInMonth(laptop, "2026-04")).toBe(25_000);
    expect(itemCostInMonth(laptop, "2028-03")).toBe(25_000);
    expect(itemCostInMonth(laptop, "2028-04")).toBe(0);
  });
});

describe("plan payments", () => {
  it("spreads a year over the twelve months it buys", () => {
    const shares = paymentShares({ paidAt: new Date("2026-03-10T10:00:00Z"), amount: 120_000, periodMonths: 12 });
    expect(shares).toHaveLength(12);
    expect(shares[0]).toEqual({ month: "2026-03", amount: 10_000 });
    expect(shares[11].month).toBe("2027-02");
  });

  it("knows which months a church was paying in", () => {
    const p = payingMonths([
      { churchId: "a", paidAt: new Date("2026-01-05T10:00:00Z"), amount: 5000, periodMonths: 1, gateway: "transfer", fee: null, international: false },
      { churchId: "a", paidAt: new Date("2026-02-05T10:00:00Z"), amount: 5000, periodMonths: 1, gateway: "transfer", fee: null, international: false },
      // A zero-naira row is a plan set by hand, not a payment.
      { churchId: "b", paidAt: new Date("2026-01-05T10:00:00Z"), amount: 0, periodMonths: 1, gateway: "admin", fee: null, international: false },
    ]);
    expect([...p.get("a")!]).toEqual(["2026-01", "2026-02"]);
    expect(p.has("b")).toBe(false);
  });

  it("measures churn as the share of one month's payers missing the next", () => {
    const paying = new Map([
      ["a", new Set(["2026-01", "2026-02", "2026-03"])],
      ["b", new Set(["2026-01"])],
    ]);
    // Jan: 2 paying, b gone in Feb. Feb: 1 paying, still there in Mar.
    expect(monthlyChurn(paying, ["2026-01", "2026-02"])).toBeCloseTo(1 / 3);
    expect(monthlyChurn(new Map(), ["2026-01"])).toBeNull();
  });
});

describe("Paystack fees", () => {
  it("follows the published local rate: 1.5%, plus ₦100 from ₦2,500, capped at ₦2,000", () => {
    expect(paystackFeeEstimate(2_000, false)).toBe(30);
    expect(paystackFeeEstimate(5_000, false)).toBe(175);
    expect(paystackFeeEstimate(500_000, false)).toBe(2_000);
  });

  it("charges an international card 3.9% plus ₦100, uncapped", () => {
    expect(paystackFeeEstimate(10_000, true)).toBe(490);
  });

  it("prefers Paystack's own figure, and never charges a fee on a bank transfer", () => {
    expect(gatewayFee({ gateway: "paystack", amount: 5000, fee: 160, international: false })).toEqual({ amount: 160, estimated: false });
    expect(gatewayFee({ gateway: "paystack", amount: 5000, fee: null, international: false })).toEqual({ amount: 175, estimated: true });
    expect(gatewayFee({ gateway: "transfer", amount: 5000, fee: null, international: false })).toEqual({ amount: 0, estimated: false });
  });
});

describe("sharing a cost", () => {
  it("splits in proportion, and returns everything as untraced when nobody qualifies", () => {
    const { byChurch, untraced } = shareOut(900, new Map([["a", 1], ["b", 2]]));
    expect(byChurch.get("a")).toBe(300);
    expect(byChurch.get("b")).toBe(600);
    expect(untraced).toBe(0);
    expect(shareOut(900, new Map()).untraced).toBe(900);
  });

  it("bills meetings only past the free allowance", () => {
    expect(meetingBillUsd(800)).toBe(0);
    expect(meetingBillUsd(1200)).toBeCloseTo(10);
  });
});

describe("Termii's own balance", () => {
  const at = (iso: string, balance: number) => ({ at: new Date(iso), balance });

  it("counts falls as spend and leaves top-ups out, whatever order the readings arrive in", () => {
    const readings = [at("2026-09-30T23:30:00Z", 10_000)];
    // ₦100 a day for the month, and a ₦5,000 top-up on the 15th.
    let balance = 10_000;
    for (let d = 1; d <= 31; d++) {
      balance -= 100;
      if (d === 15) balance += 5_000;
      readings.push(at(`2026-10-${String(d).padStart(2, "0")}T20:00:00Z`, balance));
    }
    const out = termiiSpendByMonth(readings.reverse(), new Date("2026-11-15T00:00:00Z"));
    // Day 15 nets +4,900 and reads as a top-up, so 30 days of spend are seen.
    expect(out.find((r) => r.month === "2026-10")).toEqual({ month: "2026-10", spent: 3_000, toppedUp: 4_900 });
  });

  it("refuses to vouch for a month with a hole in its readings", () => {
    const out = termiiSpendByMonth(
      [at("2026-09-30T23:30:00Z", 10_000), at("2026-10-20T00:00:00Z", 5_000), at("2026-10-31T22:00:00Z", 4_000)],
      new Date("2026-11-15T00:00:00Z"),
    );
    expect(out.find((r) => r.month === "2026-10")).toBeUndefined();
  });

  it("reads exact spend over a fully covered month", () => {
    const readings = [at("2026-09-30T23:30:00Z", 10_000)];
    for (let d = 1; d <= 31; d++) readings.push(at(`2026-10-${String(d).padStart(2, "0")}T20:00:00Z`, 10_000 - d * 100));
    const out = termiiSpendByMonth(readings, new Date("2026-11-15T00:00:00Z"));
    expect(out.find((r) => r.month === "2026-10")).toEqual({ month: "2026-10", spent: 3_100, toppedUp: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * The whole report, on a small platform worked out by hand
 * ------------------------------------------------------------------ */

const church = (id: string, over: Partial<ChurchInput> = {}): ChurchInput => ({
  id,
  name: `Church ${id}`,
  planKey: "growth",
  planLabel: "Growth",
  joined: "2026-01",
  onTrial: false,
  channel: "direct",
  members: 100,
  storageBytes: 0,
  ...over,
});

const pay = (churchId: string, iso: string, amount: number, over: Partial<PaymentInput> = {}): PaymentInput => ({
  churchId,
  paidAt: new Date(iso),
  amount,
  periodMonths: 1,
  gateway: "transfer",
  fee: null,
  international: false,
  ...over,
});

function inputs(over: Partial<CostInputs> = {}): CostInputs {
  return {
    months: ["2026-10"],
    currentMonth: null,
    churches: [church("a"), church("b", { planKey: "starter", planLabel: "Starter" })],
    items: [item({ amountNgn: 20_000 })],
    payments: [pay("a", "2026-10-03T10:00:00Z", 15_000)],
    topups: [],
    walletSpend: [],
    creditsGiven: [],
    partnerCommission: [],
    income: [],
    usage: [
      { churchId: "a", month: "2026-10", smsPages: 100, emails: 0, meetingGb: 0, active: true },
      { churchId: "b", month: "2026-10", smsPages: 0, emails: 0, meetingGb: 0, active: true },
    ],
    ai: [],
    smsUnitCost: 2.5,
    smsPrice: 4,
    termiiMeasured: [],
    ngnPerUsd: 1500,
    ...over,
  };
}

describe("buildCostReport", () => {
  it("adds up revenue, the cost to serve and the profit", () => {
    const r = buildCostReport(inputs({ walletSpend: [{ churchId: "a", month: "2026-10", category: "sms", amount: 400 }] }));
    expect(r.revenue.total).toBe(15_400);
    // Hosting 20,000 + 100 pages at ₦2.50.
    expect(r.serve).toBe(20_250);
    expect(r.profit).toBe(-4_850);
    expect(r.grossMarginPct).toBe(Math.round((-4_850 / 15_400) * 100));
  });

  it("shares hosting evenly between the churches active that month, and SMS to whoever sent it", () => {
    const r = buildCostReport(inputs());
    const a = r.churches.find((c) => c.id === "a")!;
    const b = r.churches.find((c) => c.id === "b")!;
    expect(a.costBy.core).toBe(10_000);
    expect(b.costBy.core).toBe(10_000);
    expect(a.costBy.sms).toBe(250);
    expect(a.status).toBe("paying");
    expect(b.status).toBe("free");
  });

  it("keeps a bill nobody used in the totals, as untraced, instead of losing it", () => {
    const r = buildCostReport(
      inputs({
        items: [item({ amountNgn: 8_000, category: "video", driver: "meetings", name: "TURN server" })],
      }),
    );
    expect(r.byBucket.meetings).toBe(8_000);
    expect(r.untraced).toBe(8_000);
    expect(r.lines.find((l) => l.itemId === "i1")?.untraced).toBe(8_000);
    expect(r.churches.every((c) => c.costBy.meetings === 0)).toBe(true);
  });

  it("keeps marketing and the business out of the cost to serve, but not out of profit", () => {
    const r = buildCostReport(
      inputs({
        items: [
          item({ id: "m", name: "Instagram ads", category: "marketing", driver: "none", amountNgn: 30_000, channel: "instagram" }),
          item({ id: "p", name: "Support staff", category: "people", driver: "none", amountNgn: 50_000 }),
        ],
      }),
    );
    expect(r.serve).toBe(250);
    expect(r.acquisition).toBe(30_000);
    expect(r.overhead).toBe(50_000);
    expect(r.profit).toBe(15_000 - 80_250);
  });

  it("never counts a loan or an investment as profit", () => {
    const r = buildCostReport(inputs({ income: [{ churchId: null, month: "2026-10", category: "capital", amountNgn: 1_000_000 }] }));
    expect(r.revenue.capital).toBe(1_000_000);
    expect(r.revenue.total).toBe(15_000);
  });

  it("counts wallet credit added by hand as given away, unless the church paid for it", () => {
    const gift = buildCostReport(inputs({ creditsGiven: [{ churchId: "b", month: "2026-10", kind: "by_hand", amount: 5_000 }] }));
    expect(gift.overhead).toBe(5_000);
    const paid = buildCostReport(
      inputs({
        creditsGiven: [{ churchId: "b", month: "2026-10", kind: "by_hand", amount: 5_000 }],
        income: [{ churchId: "b", month: "2026-10", category: "wallet_offline", amountNgn: 5_000 }],
      }),
    );
    expect(paid.overhead).toBe(0);
    expect(paid.revenue.churchOther).toBe(5_000);
  });

  it("works out the cost of winning a paying church, per channel", () => {
    const r = buildCostReport(
      inputs({
        churches: [church("a", { channel: "instagram" }), church("b", { channel: "partner" })],
        payments: [pay("a", "2026-10-03T10:00:00Z", 15_000), pay("b", "2026-10-04T10:00:00Z", 5_000)],
        items: [item({ id: "m", name: "Ads", category: "marketing", driver: "none", amountNgn: 30_000, channel: "Instagram" })],
        partnerCommission: [{ churchId: "b", month: "2026-10", amount: 1_000 }],
      }),
    );
    expect(r.acquisitionStats.newPaying).toBe(2);
    expect(r.acquisitionStats.cac).toBe(15_500);
    const ig = r.acquisitionStats.byChannel.find((c) => c.channel === "instagram")!;
    expect(ig).toMatchObject({ spend: 30_000, newPaying: 1, cac: 30_000 });
    expect(r.acquisitionStats.byChannel.find((c) => c.channel === "partner")?.cac).toBe(1_000);
    expect(r.churches.find((c) => c.id === "b")?.acquisition).toBe(1_000);
  });

  it("adds what Termii charged beyond the churches' own pages as SMS no church sent", () => {
    const r = buildCostReport(inputs({ termiiMeasured: [{ month: "2026-10", spent: 400 }] }));
    expect(r.sms.measured).toBe(400);
    expect(r.sms.gap).toBe(150);
    expect(r.byBucket.sms).toBe(400);
    expect(r.lines.some((l) => l.key === "sms:gap")).toBe(true);
  });

  it("estimates the fee on a Paystack payment from before the fee was kept, and says so", () => {
    const r = buildCostReport(inputs({ payments: [pay("a", "2026-10-03T10:00:00Z", 15_000, { gateway: "paystack" })] }));
    expect(r.fees.estimatedCount).toBe(1);
    expect(r.byBucket.payments).toBe(325);
    expect(r.lines.find((l) => l.key === "fees:estimated")?.basis).toBe("estimated");
  });

  it("finds how many paying churches the bills need", () => {
    const r = buildCostReport(inputs());
    // One paying church leaves 15,000 − 250 SMS; bills are 20,000 a month.
    expect(r.breakEven.contributionPerPaying).toBe(14_750);
    expect(r.breakEven.payingNeeded).toBe(2);
    expect(r.breakEven.payingNow).toBe(1);
  });

  it("groups churches by plan, per church per month", () => {
    const r = buildCostReport(inputs({ months: ["2026-09", "2026-10"] }));
    const growth = r.plans.find((p) => p.key === "growth")!;
    expect(growth.revenue).toBe(15_000);
    expect(growth.revenuePerChurchMonth).toBe(7_500);
  });

  it("converts a meetings bill past the free tier into naira and shares it by data", () => {
    const r = buildCostReport(
      inputs({
        usage: [
          { churchId: "a", month: "2026-10", smsPages: 0, emails: 0, meetingGb: 900, active: true },
          { churchId: "b", month: "2026-10", smsPages: 0, emails: 0, meetingGb: 300, active: true },
        ],
      }),
    );
    // 200 GB over at $0.05 = $10 = ₦15,000.
    expect(r.byBucket.meetings).toBeCloseTo(15_000);
    expect(r.churches.find((c) => c.id === "a")!.costBy.meetings).toBeCloseTo(11_250);
  });

  it("still counts a monthly payer as paying early in the month, before this month's payment", () => {
    const r = buildCostReport(
      inputs({ months: ["2026-11"], currentMonth: "2026-11", payments: [pay("a", "2026-10-20T10:00:00Z", 15_000)], usage: [] }),
    );
    expect(r.churches.find((c) => c.id === "a")?.status).toBe("paying");
    expect(r.breakEven.payingNow).toBe(1);
  });
});
