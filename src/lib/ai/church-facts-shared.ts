/**
 * Plain numbers in, allow-listed facts out. Pure, so every threshold here is
 * unit-tested without a database.
 *
 * Facts are built ONLY through the brand constructors (count, rate, pct,
 * indexOf), so a figure that is out of range throws here rather than
 * reaching the serialiser, and a percentage over too few records comes out
 * null rather than as a confident "100%".
 */

import type { LocaleCode } from "@/lib/i18n/locales";
import {
  count,
  indexOf,
  pct,
  rate,
  type ChurchFacts,
  type Count,
  type Index,
} from "./serialiser";
import { TREND } from "./vocab";

type Trend = (typeof TREND)[number];

/** One week of attendance, the fields of lib/attendance-metrics WeekPoint that are used. */
export type WeekRaw = {
  total: number;
  male: number;
  female: number;
  teens: number;
  children: number;
  firstTimers: number;
  newConverts: number;
  /** Sessions recorded that week. */
  count: number;
};

export type ChurchFactsRaw = {
  anchored: boolean;
  /** 12 weeks, oldest first. */
  weeks: WeekRaw[];
  weeklyAverage8: number;
  growthPct4: number | null;
  /** Average attendance per service over the window. Numbers only, never names. */
  serviceAverages: number[];
  people: {
    total: number;
    active: number;
    inactive: number;
    visitors: number;
    newConverts: number;
    withPhone: number;
    withEmail: number;
  };
  /** People added per month, 6 months, oldest first. */
  registeredByMonth: number[];
  firstTimers: {
    registered90d: number;
    becameMember90d: number;
    followUpNew: number;
    followUpContacted: number;
    followUpInProgress: number;
    followUpJoined: number;
    followUpNotInterested: number;
  };
  /** Sum of giving per COMPLETE month, 6 months, oldest first. Never sent: only its index is. */
  givingMonthlySums: number[];
  highlights: {
    groups: number;
    followUpOpen: number;
    upcomingEvents: number;
    formResponses: number;
    subscribers: number;
  };
};

const c = (n: number): Count => count(Math.max(0, Math.round(n)));

/** Within ±5% counts as steady: smaller moves are noise at church sizes. */
export const STEADY_BAND_PCT = 5;
/** The same series threshold as lib/thin-data.ts: fewer points than this is not a trend. */
export const MIN_TREND_POINTS = 5;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function trendFrom(recent: number[], prior: number[]): Trend {
  if (recent.length === 0 || prior.length === 0) return "not_enough_data";
  const before = mean(prior);
  if (before === 0) return "not_enough_data";
  const change = ((mean(recent) - before) / before) * 100;
  if (change > STEADY_BAND_PCT) return "rising";
  if (change < -STEADY_BAND_PCT) return "falling";
  return "steady";
}

/** The last 4 weeks with attendance against the 4 before them. */
export function attendanceTrend(weeks: WeekRaw[]): Trend {
  const totals = weeks.map((w) => w.total).filter((t) => t > 0);
  if (totals.length < MIN_TREND_POINTS) return "not_enough_data";
  return trendFrom(totals.slice(-4), totals.slice(-8, -4));
}

/** The last 3 months against the 3 before, once at least 3 months have giving. */
export function givingTrend(sums: number[]): Trend {
  if (sums.filter((s) => s > 0).length < 3) return "not_enough_data";
  return trendFrom(sums.slice(-3), sums.slice(-6, -3));
}

/**
 * The giving index: 100 = the first month in the window with any giving.
 * Relative only. With no giving at all the series is all nulls, because there
 * is nothing to be relative to.
 */
export function givingIndex(sums: number[]): (Index | null)[] {
  const base = sums.find((s) => s > 0);
  if (base === undefined) return sums.map(() => null);
  return sums.map((s) => indexOf(Math.max(0, s), base));
}

export function weeksWithRecords(weeks: WeekRaw[]): number {
  return weeks.filter((w) => w.count > 0).length;
}

export function monthsWithGiving(sums: number[]): number {
  return sums.filter((s) => s > 0).length;
}

/**
 * Too little to say anything true about. No call is made, and the card says
 * "record a few more weeks" instead.
 */
export function isTooThinForSummary(raw: ChurchFactsRaw): boolean {
  return (
    weeksWithRecords(raw.weeks) < 3 &&
    monthsWithGiving(raw.givingMonthlySums) < 2 &&
    raw.people.total < 10
  );
}

export function toChurchFacts(raw: ChurchFactsRaw, locale: LocaleCode): ChurchFacts {
  const weeks = raw.weeks.slice(-12);
  const parts = weeks.reduce(
    (a, w) => {
      a.men += w.male;
      a.women += w.female;
      a.teens += w.teens;
      a.children += w.children;
      a.firstTimers += w.firstTimers;
      a.newConverts += w.newConverts;
      return a;
    },
    { men: 0, women: 0, teens: 0, children: 0, firstTimers: 0, newConverts: 0 },
  );
  const whole = parts.men + parts.women + parts.teens + parts.children;
  const sums = raw.givingMonthlySums.slice(-6);
  const months = sums.length;

  return {
    meta: {
      locale,
      period: "last_12_weeks",
      anchoredToOlderData: raw.anchored ? "yes" : "no",
    },
    attendance: {
      weeklyTotals: weeks.map((w) => c(w.total)),
      weeklyAverage8: c(raw.weeklyAverage8),
      growthPct4: raw.growthPct4 === null ? null : pctFromChange(raw.growthPct4),
      trend: attendanceTrend(weeks),
      weeksWithRecords: c(weeksWithRecords(weeks)),
      adultMenShare: rate(parts.men, whole),
      adultWomenShare: rate(parts.women, whole),
      teensShare: rate(parts.teens, whole),
      childrenShare: rate(parts.children, whole),
      firstTimers12w: c(parts.firstTimers),
      newConverts12w: c(parts.newConverts),
      // Sorted, so the position says "largest service", not which one.
      serviceAverages: [...raw.serviceAverages]
        .map((n) => Math.max(0, Math.round(n)))
        .sort((a, b) => b - a)
        .slice(0, 8)
        .map(c),
    },
    people: {
      total: c(raw.people.total),
      active: c(raw.people.active),
      inactive: c(raw.people.inactive),
      visitors: c(raw.people.visitors),
      newConverts: c(raw.people.newConverts),
      registeredByMonth: raw.registeredByMonth.slice(-6).map(c),
      phoneOnFileRate: rate(raw.people.withPhone, raw.people.total),
      emailOnFileRate: rate(raw.people.withEmail, raw.people.total),
    },
    firstTimers: {
      registered90d: c(raw.firstTimers.registered90d),
      becameMember90dRate: rate(raw.firstTimers.becameMember90d, raw.firstTimers.registered90d),
      followUpNew: c(raw.firstTimers.followUpNew),
      followUpContacted: c(raw.firstTimers.followUpContacted),
      followUpInProgress: c(raw.firstTimers.followUpInProgress),
      followUpJoined: c(raw.firstTimers.followUpJoined),
      followUpNotInterested: c(raw.firstTimers.followUpNotInterested),
    },
    giving: {
      monthlyIndex: givingIndex(sums),
      monthOverMonthPct: months >= 2 ? pct(sums[months - 1], sums[months - 2]) : null,
      monthsWithRecords: c(monthsWithGiving(sums)),
      trend: givingTrend(sums),
    },
    engagement: {
      groups: c(raw.highlights.groups),
      openFollowUps: c(raw.highlights.followUpOpen),
      upcomingEvents: c(raw.highlights.upcomingEvents),
      formResponses: c(raw.highlights.formResponses),
      devotionalSubscribers: c(raw.highlights.subscribers),
    },
  };
}

/**
 * growthPct() already returns a whole-number percentage change. Re-expressed
 * through pct() as (100 + g) against 100, so it is range-checked and clamped
 * by the same constructor as every other change.
 */
function pctFromChange(g: number) {
  return pct(100 + g, 100);
}
