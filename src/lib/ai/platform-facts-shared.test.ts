import { describe, expect, it, vi } from "vitest";
import { bucketWeeks, toArea, toPlatformFacts, topAreas, type PlatformFactsRaw } from "./platform-facts-shared";
import { serialise } from "./serialiser";

function raw(): PlatformFactsRaw {
  return {
    overview: {
      totalChurches: 14,
      activeChurches: 9,
      atRisk: 2,
      neverActivated: 3,
      mrrDeltaPct: 12,
      revenueMonthDeltaPct: null,
      revenueAtRisk: 45_000,
      mrr: 300_000,
    },
    growth: Array.from({ length: 90 }, (_, i) => ({
      day: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
      signups: i >= 60 ? 1 : 0,
      activeChurches: i % 7,
    })),
    usage: {
      dau: 4,
      wau: 12,
      mau: 30,
      activeChurches7: 8,
      topFeatures: [{ name: "Members" }, { name: "Grace-chapel-ikeja" }, { name: "Follow-up" }, { name: "Wp-admin" }],
    },
    planMix: [
      { plan: "starter", n: 5 },
      { plan: "growth", n: 6 },
      { plan: "pro", n: 3 },
    ],
  };
}

describe("areas", () => {
  it("maps any name outside the known labels to Other, once", () => {
    expect(toArea("Members")).toBe("Members");
    expect(toArea("Grace-chapel-ikeja")).toBe("Other");
    expect(topAreas(raw().usage.topFeatures)).toEqual(["Members", "Other", "Follow-up"]);
  });
});

describe("bucketWeeks", () => {
  it("puts 90 days into 13 weeks, newest last, summing signups and taking the busiest day", () => {
    const daily = Array.from({ length: 90 }, (_, i) => ({ signups: 1, activeChurches: i }));
    const { signups, active } = bucketWeeks(daily);
    expect(signups).toHaveLength(13);
    expect(signups.reduce((a, b) => a + b, 0)).toBe(90);
    expect(signups[12]).toBe(7);
    expect(signups[0]).toBe(6);
    expect(active[12]).toBe(89);
  });
});

describe("toPlatformFacts", () => {
  it("passes the serialiser with percentages only, and splits 30-day signups", () => {
    const facts = toPlatformFacts(raw());
    expect(facts.churches.signups30d).toBe(30);
    expect(facts.churches.signupsPrev30d).toBe(0);
    expect(facts.churches.byPlan).toEqual({ starter: 5, growth: 6, pro: 3, enterprise: 0 });
    expect(facts.revenue.mrrChangePct).toBe(12);
    expect(facts.revenue.revenueAtRiskShare).toBe(0.15);
    const json = serialise("platform-facts@1", facts).json;
    expect(json).not.toContain("300000");
  });

  it("keeps a church name or slug passed in by mistake out of the output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = raw() as PlatformFactsRaw & { churchName?: string; overview: { slug?: string } };
    r.churchName = "Grace Chapel Ikeja";
    r.overview.slug = "grace-chapel-ikeja";
    const json = serialise("platform-facts@1", toPlatformFacts(r)).json;
    expect(json).not.toMatch(/grace/i);
    warn.mockRestore();
  });
});
