import { describe, expect, it } from "vitest";
import { accuracyChecks, recommendations, type InsightContext } from "./cost-insights-shared";
import { buildCostReport, type CostInputs } from "./cost-to-serve-shared";
import { toFinanceFacts, trendOf } from "./ai/finance-facts-shared";
import { serialise } from "./ai/serialiser";

const ctx = (over: Partial<InsightContext> = {}): InsightContext => ({
  itemsActive: 1,
  categories: ["hosting"],
  unitCost: "manual",
  termiiConfigured: true,
  ngnPerUsd: 1500,
  marketNgnPerUsd: 1480,
  rateIsOwn: false,
  foreignCost: 0,
  pendingAmount: 0,
  payingWithoutSource: 0,
  storageDriverUsed: false,
  unusedItems: [],
  periodLabel: "in October",
  ...over,
});

function input(over: Partial<CostInputs> = {}): CostInputs {
  return {
    months: ["2026-10"],
    currentMonth: null,
    churches: [
      { id: "a", name: "Grace Chapel", planKey: "growth", planLabel: "Growth", joined: "2026-01", onTrial: false, channel: "direct", members: 50, storageBytes: 0 },
      { id: "b", name: "Hope Assembly", planKey: "starter", planLabel: "Starter", joined: "2026-01", onTrial: true, channel: "direct", members: 20, storageBytes: 0 },
    ],
    items: [
      { id: "i1", name: "VPS", category: "hosting", amountNgn: 40_000, foreign: false, frequency: "monthly", startsOn: "2026-01-01", endsOn: null, spreadMonths: null, driver: "active_churches", channel: null },
    ],
    payments: [{ churchId: "a", paidAt: new Date("2026-10-02T10:00:00Z"), amount: 15_000, periodMonths: 1, gateway: "transfer", fee: null, international: false }],
    topups: [],
    walletSpend: [],
    creditsGiven: [],
    partnerCommission: [],
    income: [],
    usage: [
      { churchId: "a", month: "2026-10", smsPages: 200, emails: 0, meetingGb: 0, active: true },
      { churchId: "b", month: "2026-10", smsPages: 0, emails: 0, meetingGb: 0, active: true },
    ],
    ai: [],
    smsUnitCost: 3.5,
    smsPrice: 4,
    termiiMeasured: [],
    ngnPerUsd: 1500,
    ...over,
  };
}

describe("recommendations", () => {
  it("leads with the loss, and says how many paying churches the bills need", () => {
    const r = buildCostReport(input());
    const [first] = recommendations(r, ctx());
    expect(first.tone).toBe("bad");
    expect(first.title).toContain("You lost");
    expect(first.body).toMatch(/your bills need \d+ paying churches; you have 1/);
  });

  it("names a paying church that costs more than it pays", () => {
    const r = buildCostReport(input());
    const losing = recommendations(r, ctx()).find((i) => i.key === "losing-paying");
    expect(losing?.body).toContain("Grace Chapel");
  });

  it("warns when an SMS page earns too little over what Termii charges", () => {
    const r = buildCostReport(input());
    const sms = recommendations(r, ctx()).find((i) => i.key === "sms-markup");
    expect(sms?.title).toContain("14%");
  });

  it("says when there is nothing to work out, instead of a loss of ₦0", () => {
    const r = buildCostReport(input({ items: [], payments: [], usage: [] }));
    expect(recommendations(r, ctx()).map((i) => i.key)).toEqual(["empty"]);
  });
});

describe("one bill dominating", () => {
  it("adds up a bill whose price changed, instead of quoting one of its lines", () => {
    const r = buildCostReport(
      input({
        months: ["2026-09", "2026-10"],
        items: [
          { id: "old", name: "VPS", category: "hosting", amountNgn: 40_000, foreign: false, frequency: "monthly", startsOn: "2026-01-01", endsOn: "2026-09-30", spreadMonths: null, driver: "active_churches", channel: null },
          { id: "new", name: "VPS", category: "hosting", amountNgn: 50_000, foreign: false, frequency: "monthly", startsOn: "2026-10-01", endsOn: null, spreadMonths: null, driver: "active_churches", channel: null },
          { id: "d", name: "Domain", category: "domain", amountNgn: 24_000, foreign: false, frequency: "yearly", startsOn: "2026-01-01", endsOn: null, spreadMonths: null, driver: "active_churches", channel: null },
        ],
      }),
    );
    const dominant = recommendations(r, ctx()).find((i) => i.key === "dominant");
    expect(dominant?.title).toBe(`VPS is ${Math.round((90_000 / r.totalCost) * 100)}% of everything you spend`);
  });
});

describe("accuracy checks", () => {
  it("asks for the bills every platform pays for", () => {
    const r = buildCostReport(input());
    const keys = accuracyChecks(r, ctx()).filter((c) => c.status === "missing").map((c) => c.key);
    expect(keys).toEqual(["cat:domain", "cat:email"]);
  });

  it("offers to fetch Paystack's real fee for an estimated one", () => {
    const r = buildCostReport(
      input({ payments: [{ churchId: "a", paidAt: new Date("2026-10-02T10:00:00Z"), amount: 15_000, periodMonths: 1, gateway: "paystack", fee: null, international: false }] }),
    );
    expect(accuracyChecks(r, ctx()).find((c) => c.key === "fees")?.fix?.action).toBe("fetch-fees");
  });

  it("says a derived cost per page cannot vouch for itself against the same balance", () => {
    const r = buildCostReport(input({ termiiMeasured: [{ month: "2026-10", spent: 700 }] }));
    const termii = accuracyChecks(r, ctx({ unitCost: "derived" })).find((c) => c.key === "termii");
    expect(termii?.status).toBe("ok");
    expect(termii?.detail).toContain("proves little");
  });
});

describe("the finance briefing payload", () => {
  it("serialises, and carries no amount of money from the report", () => {
    const r = buildCostReport(input({ months: ["2026-08", "2026-09", "2026-10"] }));
    const json = serialise("finance-facts@1", toFinanceFacts(r, r.series, 0)).json;
    for (const n of [40_000, 15_000, 120_000, 700]) expect(json).not.toContain(String(n));
    expect(json).not.toContain("Grace");
    expect(JSON.parse(json).margins.profitable).toBe("no");
  });

  it("calls a trend only with six months to compare", () => {
    const flat = Array.from({ length: 6 }, (_, i) => ({ month: `2026-0${i + 1}`, revenue: 100, serve: 50, costs: 80, profit: 20 }));
    expect(trendOf(flat.slice(0, 5), (p) => p.revenue, () => 300)).toBe("not_enough_data");
    expect(trendOf(flat, (p) => p.revenue, () => 300)).toBe("steady");
    const up = flat.map((p, i) => (i >= 3 ? { ...p, revenue: 200 } : p));
    expect(trendOf(up, (p) => p.revenue, () => 300)).toBe("rising");
  });
});
