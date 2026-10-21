/**
 * The operator's own business figures, aggregated across the platform, as
 * allow-listed facts. No church name, slug or id is ever read into them, so
 * church opt-in does not govern this payload; the kill switch and the
 * platform budget do. Pure.
 */

import { count, pct, rate, type Count, type PlatformFacts } from "./serialiser";
import { AREA } from "./vocab";

type Area = (typeof AREA)[number];

export type PlatformFactsRaw = {
  overview: {
    totalChurches: number;
    activeChurches: number;
    atRisk: number;
    neverActivated: number;
    /** Whole-number % change, as getOverviewStats returns it, or null. */
    mrrDeltaPct: number | null;
    revenueMonthDeltaPct: number | null;
    revenueAtRisk: number;
    mrr: number;
  };
  /** Daily points, oldest first (getGrowthSeries(90)). */
  growth: { day: string; signups: number; activeChurches: number }[];
  usage: {
    dau: number;
    wau: number;
    mau: number;
    activeChurches7: number;
    /** getUsageOverview().topFeatures, most viewed first. */
    topFeatures: { name: string }[];
  };
  planMix: { plan: string; n: number }[];
};

const c = (n: number): Count => count(Math.max(0, Math.round(n)));

/**
 * featureFromPath capitalises any path segment it does not recognise, so an
 * analytics name can be whatever a URL contained. Only the known labels pass;
 * everything else becomes "Other".
 */
export function toArea(name: string): Area {
  return (AREA as readonly string[]).includes(name) && name !== "Other" ? (name as Area) : "Other";
}

export function topAreas(features: { name: string }[], max = 5): Area[] {
  const out: Area[] = [];
  for (const f of features) {
    const a = toArea(f.name);
    if (!out.includes(a)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Bucket daily points into 13 weeks, newest bucket last, counting back from
 * the newest day (90 days fill 12 full weeks and one 6-day week).
 *
 * Signups are summed. Active churches are a daily DISTINCT count, so summing
 * them would count one church seven times; the week takes its busiest day.
 */
export function bucketWeeks(
  daily: { signups: number; activeChurches: number }[],
  weeks = 13,
): { signups: number[]; active: number[] } {
  const signups = Array.from({ length: weeks }, () => 0);
  const active = Array.from({ length: weeks }, () => 0);
  for (let i = 0; i < daily.length; i++) {
    const fromEnd = daily.length - 1 - i;
    const bucket = weeks - 1 - Math.floor(fromEnd / 7);
    if (bucket < 0) continue;
    signups[bucket] += daily[i].signups;
    active[bucket] = Math.max(active[bucket], daily[i].activeChurches);
  }
  return { signups, active };
}

function sumLast(daily: { signups: number }[], from: number, to: number): number {
  // Days counted back from the newest: [from, to).
  let s = 0;
  for (let k = from; k < to; k++) {
    const p = daily[daily.length - 1 - k];
    if (p) s += p.signups;
  }
  return s;
}

export function toPlatformFacts(raw: PlatformFactsRaw): PlatformFacts {
  const weeks = bucketWeeks(raw.growth);
  const plan = (p: string) => raw.planMix.filter((r) => r.plan === p).reduce((a, r) => a + r.n, 0);
  return {
    meta: { period: "last_90_days" },
    churches: {
      total: c(raw.overview.totalChurches),
      active30: c(raw.overview.activeChurches),
      atRisk: c(raw.overview.atRisk),
      neverActivated: c(raw.overview.neverActivated),
      signups30d: c(sumLast(raw.growth, 0, 30)),
      signupsPrev30d: c(sumLast(raw.growth, 30, 60)),
      byPlan: {
        starter: c(plan("starter")),
        growth: c(plan("growth")),
        pro: c(plan("pro")),
        enterprise: c(plan("enterprise")),
      },
    },
    growth: {
      weeklySignups: weeks.signups.map(c),
      weeklyActiveChurches: weeks.active.map(c),
    },
    revenue: {
      // The stats already hold whole-number % changes; pct() range-checks them.
      mrrChangePct: raw.overview.mrrDeltaPct === null ? null : pct(100 + raw.overview.mrrDeltaPct, 100),
      revenueMonthChangePct:
        raw.overview.revenueMonthDeltaPct === null ? null : pct(100 + raw.overview.revenueMonthDeltaPct, 100),
      revenueAtRiskShare: rate(raw.overview.revenueAtRisk, raw.overview.mrr),
    },
    usage: {
      dau: c(raw.usage.dau),
      wau: c(raw.usage.wau),
      mau: c(raw.usage.mau),
      activeChurches7: c(raw.usage.activeChurches7),
      topAreas: topAreas(raw.usage.topFeatures),
    },
  };
}
