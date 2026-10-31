/**
 * The cost report as allow-listed facts for the finance briefing. Pure.
 *
 * What leaves: whole-percentage margins, shares of revenue and of cost
 * (0–1), counts of churches and months, one index, and three trend words.
 * What never leaves: any amount of money, any church's name or id, any
 * vendor or cost name. A share says hosting is 62% of costs; it cannot say
 * what was paid, or to whom.
 */

import type { CostReport, MonthPoint } from "@/lib/cost-to-serve-shared";
import { count, indexOf, pct, rate, type Count, type FinanceFacts, type Pct } from "./serialiser";

const c = (n: number): Count => count(Math.min(10_000_000, Math.max(0, Math.round(n))));
const optCount = (n: number | null): Count | null => (n == null || !Number.isFinite(n) ? null : c(n));
/** A whole percentage the report already computed, through pct() so it is range-checked. */
const asPct = (n: number | null): Pct | null => (n == null ? null : pct(100 + n, 100));

type Trend = "rising" | "steady" | "falling" | "not_enough_data";

/**
 * Last three finished months against the three before. Needs all six to have
 * something in them; a 5% move either way is "steady".
 */
export function trendOf(points: MonthPoint[], pick: (p: MonthPoint) => number, scale: (p: MonthPoint[]) => number): Trend {
  if (points.length < 6) return "not_enough_data";
  const six = points.slice(-6);
  if (six.every((p) => p.revenue === 0 && p.costs === 0)) return "not_enough_data";
  const before = six.slice(0, 3).reduce((n, p) => n + pick(p), 0);
  const after = six.slice(3).reduce((n, p) => n + pick(p), 0);
  const base = scale(six);
  if (!(base > 0)) return "not_enough_data";
  const move = (after - before) / base;
  return move > 0.05 ? "rising" : move < -0.05 ? "falling" : "steady";
}

export function isTooThinForFinance(r: CostReport): boolean {
  return r.revenue.total === 0 && r.totalCost === 0;
}

/**
 * @param r       the report over the briefing's months (the last three finished)
 * @param history six finished months, oldest first, for the trends
 * @param dollarCost entered costs priced in dollars, in naira, over the same months as `r`
 */
export function toFinanceFacts(r: CostReport, history: MonthPoint[], dollarCost: number): FinanceFacts {
  const statusCount = (k: string) => r.statuses.find((s) => s.key === k)?.churches ?? 0;
  const notPayingCost = r.statuses.filter((s) => s.key !== "paying").reduce((n, s) => n + s.cost, 0);
  const plan = (k: string) => asPct(r.plans.find((p) => p.key === k && p.revenue > 0)?.marginPct ?? null);
  const share = (n: number) => rate(n, r.totalCost);
  const revShare = (n: number) => rate(n, r.revenue.total);
  const entered = r.lines.filter((l) => l.basis === "entered").reduce((n, l) => n + l.amount, 0);
  const a = r.acquisitionStats;
  const absRevenue = (ps: MonthPoint[]) => ps.reduce((n, p) => n + p.revenue, 0) / 2;
  const absCosts = (ps: MonthPoint[]) => ps.reduce((n, p) => n + p.costs, 0) / 2;

  return {
    meta: { period: "last_3_months" },
    churches: {
      paying: c(statusCount("paying")),
      onTrial: c(statusCount("trial")),
      notPaying: c(statusCount("free")),
      newPaying: c(a.newPaying),
      costMoreThanTheyPay: c(r.churches.filter((x) => x.margin < 0).length),
      payingCostMoreThanTheyPay: c(r.churches.filter((x) => x.status === "paying" && x.margin < 0).length),
    },
    margins: {
      profitable: r.profit >= 0 ? "yes" : "no",
      grossPct: asPct(r.grossMarginPct),
      netPct: asPct(r.marginPct),
    },
    costShare: {
      core: share(r.byBucket.core),
      sms: share(r.byBucket.sms),
      mail: share(r.byBucket.mail),
      meetings: share(r.byBucket.meetings),
      media: share(r.byBucket.media),
      ai: share(r.byBucket.ai),
      payments: share(r.byBucket.payments),
      acquisition: share(r.byBucket.acquisition),
      overhead: share(r.byBucket.overhead),
    },
    revenueShare: {
      plans: revShare(r.revenue.subscriptions),
      smsWallet: revShare(r.revenue.walletSms),
      storageWallet: revShare(r.revenue.walletStorage),
      other: revShare(r.revenue.churchOther + r.revenue.otherIncome),
    },
    sms: {
      markupPct: asPct(r.sms.markupPct),
      untracedShare: r.sms.measured != null && r.sms.gap != null ? rate(Math.max(0, r.sms.gap), r.sms.measured) : null,
    },
    unitEconomics: {
      breakEvenPayingChurches: optCount(r.breakEven.payingNeeded),
      paybackMonths: optCount(a.paybackMonths),
      lifetimeValueToAcquisitionIndex: a.ltvToCac == null ? null : indexOf(a.ltvToCac, 1),
      monthlyChurn: a.monthlyChurn == null ? null : rate(Math.round(a.monthlyChurn * 1000), 1000),
      dollarCostShare: rate(dollarCost, entered),
      notPayingShareOfServeCost: rate(notPayingCost, r.serve),
    },
    trend: {
      revenue: trendOf(history, (p) => p.revenue, absRevenue),
      costs: trendOf(history, (p) => p.costs, absCosts),
      profit: trendOf(history, (p) => p.profit, (ps) => Math.max(absRevenue(ps), absCosts(ps))),
    },
    planMarginPct: { starter: plan("starter"), growth: plan("growth"), pro: plan("pro"), enterprise: plan("enterprise") },
  };
}
