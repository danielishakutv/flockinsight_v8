import { describe, expect, it } from "vitest";
import {
  attendanceTrend,
  givingIndex,
  givingTrend,
  isTooThinForSummary,
  toChurchFacts,
  type ChurchFactsRaw,
  type WeekRaw,
} from "./church-facts-shared";
import { serialise } from "./serialiser";

const week = (total: number): WeekRaw => ({
  total,
  male: Math.round(total * 0.3),
  female: Math.round(total * 0.45),
  teens: Math.round(total * 0.1),
  children: Math.round(total * 0.15),
  firstTimers: total > 0 ? 2 : 0,
  newConverts: total > 0 ? 1 : 0,
  count: total > 0 ? 1 : 0,
});

function raw(over: Partial<ChurchFactsRaw> = {}): ChurchFactsRaw {
  return {
    anchored: false,
    weeks: [120, 130, 0, 140, 150, 160, 150, 170, 180, 175, 190, 200].map(week),
    weeklyAverage8: 172,
    growthPct4: 14,
    serviceAverages: [60.4, 140.6, 25],
    people: { total: 240, active: 180, inactive: 20, visitors: 30, newConverts: 10, withPhone: 200, withEmail: 90 },
    registeredByMonth: [4, 6, 2, 8, 5, 7],
    firstTimers: {
      registered90d: 25,
      becameMember90d: 5,
      followUpNew: 6,
      followUpContacted: 4,
      followUpInProgress: 3,
      followUpJoined: 5,
      followUpNotInterested: 2,
    },
    givingMonthlySums: [0, 412_500.5, 380_000, 455_000, 520_000, 498_250],
    highlights: { groups: 8, followUpOpen: 13, upcomingEvents: 2, formResponses: 40, subscribers: 55 },
    ...over,
  };
}

describe("toChurchFacts", () => {
  it("builds facts that pass the serialiser", () => {
    const p = serialise("church-facts@1", toChurchFacts(raw(), "fr"));
    const obj = JSON.parse(p.json);
    expect(obj.meta.locale).toBe("fr");
    expect(obj.attendance.weeklyTotals).toHaveLength(12);
    expect(obj.people.phoneOnFileRate).toBe(0.83);
    expect(obj.firstTimers.becameMember90dRate).toBe(0.2);
  });

  it("carries no money: the giving index starts at 100 on the first month with giving", () => {
    const facts = toChurchFacts(raw(), "en");
    expect(facts.giving.monthlyIndex).toEqual([0, 100, 90, 110, 125, 120]);
    const json = serialise("church-facts@1", facts).json;
    for (const amount of ["412500", "412500.5", "380000", "498250", "520000"]) {
      expect(json).not.toContain(amount);
    }
  });

  it("gives an all-null index and not_enough_data when there is no giving", () => {
    const facts = toChurchFacts(raw({ givingMonthlySums: [0, 0, 0, 0, 0, 0] }), "en");
    expect(facts.giving.monthlyIndex).toEqual([null, null, null, null, null, null]);
    expect(facts.giving.trend).toBe("not_enough_data");
    expect(facts.giving.monthOverMonthPct).toBeNull();
  });

  it("sorts service averages largest first and keeps only numbers", () => {
    const facts = toChurchFacts(raw(), "en");
    expect(facts.attendance.serviceAverages).toEqual([141, 60, 25]);
  });

  it("re-expresses growthPct through pct() unchanged", () => {
    expect(toChurchFacts(raw(), "en").attendance.growthPct4).toBe(14);
    expect(toChurchFacts(raw({ growthPct4: null }), "en").attendance.growthPct4).toBeNull();
  });
});

describe("trends", () => {
  it("attendance: fewer than 5 weeks with figures is not_enough_data", () => {
    expect(attendanceTrend([0, 0, 0, 0, 0, 0, 0, 0, 100, 110, 120, 130].map(week))).toBe("not_enough_data");
    expect(attendanceTrend([0, 0, 0, 0, 0, 0, 0, 100, 100, 110, 120, 130].map(week))).not.toBe("not_enough_data");
  });

  it("attendance: within ±5% is steady, beyond is rising or falling", () => {
    const flat = [100, 100, 100, 100, 104, 104, 104, 104].map(week);
    expect(attendanceTrend(flat)).toBe("steady");
    const up = [100, 100, 100, 100, 106, 106, 106, 106].map(week);
    expect(attendanceTrend(up)).toBe("rising");
    const down = [100, 100, 100, 100, 94, 94, 94, 94].map(week);
    expect(attendanceTrend(down)).toBe("falling");
  });

  it("giving: needs three months with giving", () => {
    expect(givingTrend([0, 0, 0, 0, 10, 10])).toBe("not_enough_data");
    expect(givingTrend([100, 100, 100, 120, 120, 120])).toBe("rising");
  });

  it("givingIndex buckets to the nearest 5", () => {
    expect(givingIndex([100, 103, 108])).toEqual([100, 105, 110]);
  });
});

describe("isTooThinForSummary", () => {
  const thin = raw({
    weeks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 60].map(week),
    givingMonthlySums: [0, 0, 0, 0, 0, 100],
    people: { total: 9, active: 9, inactive: 0, visitors: 0, newConverts: 0, withPhone: 0, withEmail: 0 },
  });

  it("is true only when attendance, giving and people are all too thin", () => {
    expect(isTooThinForSummary(thin)).toBe(true);
    expect(isTooThinForSummary({ ...thin, people: { ...thin.people, total: 10 } })).toBe(false);
    expect(isTooThinForSummary({ ...thin, givingMonthlySums: [0, 0, 0, 0, 100, 100] })).toBe(false);
    expect(isTooThinForSummary({ ...thin, weeks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 50, 60].map(week) })).toBe(false);
  });
});
