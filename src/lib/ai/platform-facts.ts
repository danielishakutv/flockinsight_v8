import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getGrowthSeries, getOverviewStats } from "@/lib/platform-stats";
import { getUsageOverview } from "@/lib/analytics";
import type { PlatformFactsRaw } from "./platform-facts-shared";

/*
 * The platform summary's inputs. getOverviewStats and getGrowthSeries are
 * unstable_cache'd, and both return only numbers and day strings, so the
 * cached-Date revival trap does not apply. No church name, slug or id is
 * read into the result: the plan mix is a grouped count.
 */
export async function loadPlatformFactsRaw(): Promise<PlatformFactsRaw> {
  const [overview, growth, usage, planRows] = await Promise.all([
    getOverviewStats(),
    getGrowthSeries(90),
    getUsageOverview(),
    db
      .select({ plan: church.plan, n: sql<string>`count(*)` })
      .from(church)
      .where(eq(church.isDemo, false))
      .groupBy(church.plan),
  ]);
  return {
    overview: {
      totalChurches: overview.totalChurches,
      activeChurches: overview.activeChurches,
      atRisk: overview.atRisk,
      neverActivated: overview.neverActivated,
      mrrDeltaPct: overview.mrr.delta,
      revenueMonthDeltaPct: overview.revenueMonth.delta,
      revenueAtRisk: overview.revenueAtRisk,
      mrr: overview.mrr.value,
    },
    growth: growth.map((g) => ({ day: g.day, signups: g.signups, activeChurches: g.activeChurches })),
    usage: {
      dau: usage.dau,
      wau: usage.wau,
      mau: usage.mau,
      activeChurches7: usage.activeChurches7,
      topFeatures: usage.topFeatures.map((f) => ({ name: f.name })),
    },
    planMix: planRows.map((r) => ({ plan: String(r.plan), n: Number(r.n) })),
  };
}
