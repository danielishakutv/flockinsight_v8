import "server-only";
import { unstable_cache } from "next/cache";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { getPlanPrices } from "@/lib/pricing";
import { getTermiiUnitCost, getSmsPrice } from "@/lib/platform-settings";
import { getChurchHealth, type ChurchHealthRow } from "@/lib/platform-health";
import { church, payment, platformMrrSnapshot } from "@/db/schema";
import { churchMrr, type MrrPayment } from "@/lib/mrr";

/**
 * Platform metrics for the command centre.
 *
 * Every headline number carries a period-over-period delta: a bare count says
 * nothing actionable, while "52, down from 61" says everything. Deltas are
 * `null` when the prior period was zero rather than a fake 100%.
 */

export type Metric = { value: number; delta: number | null };

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

type CountRow = { n: string };

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  const row = (res.rows[0] ?? {}) as unknown as CountRow;
  return Number(row.n ?? 0);
}

export type OverviewStats = {
  mrr: Metric;
  revenueMonth: Metric;
  activeChurches: number;
  totalChurches: number;
  atRisk: number;
  neverActivated: number;
  revenueAtRisk: number;
  newSignups: Metric;
  marginMonth: number | null;
};

async function loadOverviewStats(): Promise<OverviewStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    prices,
    unitCost,
    smsPrice,
    healthRows,
    billingRows,
    latestPayments,
    revenueMonth,
    revenuePrevMonth,
    signupsMonth,
    signupsPrevMonth,
    pagesMonth,
  ] = await Promise.all([
    getPlanPrices(),
    getTermiiUnitCost(),
    getSmsPrice(),
    getChurchHealth(),
    // What decides whether a church is paying at all: computeStanding's inputs.
    db
      .select({
        id: church.id,
        plan: church.plan,
        status: church.status,
        discountPct: church.planDiscountPct,
        paymentWaived: church.paymentWaived,
        paymentWaivedUntil: church.paymentWaivedUntil,
        trialEndsAt: church.trialEndsAt,
        planRenewsAt: church.planRenewsAt,
      })
      .from(church),
    /*
     * Each church's latest successful payment OF REAL MONEY — what it
     * actually pays. One table, no join, joined to the churches in JS (a
     * correlated raw-SQL subquery here is exactly the AGENTS.md qualifier
     * trap).
     *
     * Real money only: a ₦0 row (a FREE- activation, an operator's "set the
     * plan") paid nothing, and as the latest row it used to hide the transfer
     * before it, so the church fell back to list price. A church whose plan
     * no real payment explains still falls back to its discounted list price
     * (lib/mrr.ts) — deliberately, because most ₦0 operator rows are churches
     * paying by transfer from before Record payment existed, and counting
     * them as nothing would understate revenue far more than the rare comp
     * whose discount was later lowered overstates it.
     */
    db
      .selectDistinctOn([payment.churchId], {
        churchId: payment.churchId,
        plan: payment.plan,
        amount: payment.amount,
        surchargeAmount: payment.surchargeAmount,
        periodMonths: payment.periodMonths,
      })
      .from(payment)
      // A deleted church's payments are history, not recurring revenue.
      .where(
        and(
          eq(payment.status, "success"),
          gt(payment.amount, 0),
          isNotNull(payment.churchId),
        ),
      )
      .orderBy(payment.churchId, desc(sql`coalesce(${payment.paidAt}, ${payment.createdAt})`)),
    // Bucketed by when the money LANDED, as the finance page does: a
    // backdated transfer belongs to the month it was paid in.
    scalar(sql`select coalesce(sum(amount), 0) as n from payment
               where status = 'success' and coalesce(paid_at, created_at) >= ${monthStart}`),
    scalar(sql`select coalesce(sum(amount), 0) as n from payment
               where status = 'success' and coalesce(paid_at, created_at) >= ${lastMonthStart}
                 and coalesce(paid_at, created_at) < ${monthStart}`),
    scalar(sql`select count(*) as n from church where created_at >= ${monthStart}`),
    scalar(sql`select count(*) as n from church
               where created_at >= ${lastMonthStart} and created_at < ${monthStart}`),
    scalar(sql`select coalesce(sum(count), 0) as n from usage_stat
               where metric = 'sms_pages'
                 and day >= ${monthStart.toISOString().slice(0, 10)}`),
  ]);

  /*
   * MRR: what each church that is actually paid up actually pays, a month
   * at a time (lib/mrr.ts). Not the list price of every church's plan, which
   * counted every free trial as a paying Starter.
   */
  const latestByChurch = new Map<string, MrrPayment>(
    latestPayments.flatMap((p) =>
      p.churchId
        ? [
            [
              p.churchId,
              {
                plan: p.plan,
                amount: Number(p.amount),
                surchargeAmount: Number(p.surchargeAmount ?? 0),
                periodMonths: p.periodMonths,
              },
            ] as const,
          ]
        : [],
    ),
  );
  const listPrices = prices as Record<string, number | null>;
  const valueOf = new Map<string, number>(
    billingRows.map((c) => [
      c.id,
      churchMrr(c, latestByChurch.get(c.id) ?? null, listPrices, now),
    ]),
  );
  const mrrNow = [...valueOf.values()].reduce((sum, v) => sum + v, 0);

  // Paying churches whose revenue is in danger: gone quiet, or never started.
  // A trial church at risk is a lost lead, not lost revenue.
  const atRiskRows = healthRows.filter(
    (r) => r.health === "at_risk" || r.health === "never_activated",
  );
  const revenueAtRisk = atRiskRows.reduce(
    (sum, r) => sum + (valueOf.get(r.churchId) ?? 0),
    0,
  );

  const cutoff = Date.now() - 7 * 86_400_000;

  return {
    // MRR has no natural "previous" snapshot without history, so its delta is
    // left null rather than invented.
    mrr: { value: mrrNow, delta: null },
    revenueMonth: {
      value: revenueMonth,
      delta: pctDelta(revenueMonth, revenuePrevMonth),
    },
    activeChurches: healthRows.filter(
      (r) => (r.lastSeenAt?.getTime() ?? 0) >= cutoff,
    ).length,
    totalChurches: healthRows.length,
    atRisk: healthRows.filter((r) => r.health === "at_risk").length,
    neverActivated: healthRows.filter((r) => r.health === "never_activated").length,
    revenueAtRisk,
    newSignups: {
      value: signupsMonth,
      delta: pctDelta(signupsMonth, signupsPrevMonth),
    },
    marginMonth:
      unitCost === null ? null : +(pagesMonth * (smsPrice - unitCost)).toFixed(2),
  };
}

export const getOverviewStats = unstable_cache(
  loadOverviewStats,
  ["overview-stats"],
  { revalidate: 60, tags: ["platform-stats"] },
);

/**
 * Write today's size and worth down, once a day.
 *
 * Uncached on purpose — it runs from the health cron, where reading a minute-old
 * figure and storing it as the day's record would quietly enshrine a stale
 * number. The day is the primary key, so the last write of the day wins and
 * running the cron every half hour costs one upsert.
 */
export async function recordMrrSnapshot(): Promise<{
  day: string;
  mrr: number;
  activeChurches: number;
  totalChurches: number;
}> {
  const stats = await loadOverviewStats();
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  await db
    .insert(platformMrrSnapshot)
    .values({
      day,
      mrr: Math.round(stats.mrr.value),
      activeChurches: stats.activeChurches,
      totalChurches: stats.totalChurches,
    })
    .onConflictDoUpdate({
      target: platformMrrSnapshot.day,
      set: {
        mrr: Math.round(stats.mrr.value),
        activeChurches: stats.activeChurches,
        totalChurches: stats.totalChurches,
        capturedAt: now,
      },
    });

  return {
    day,
    mrr: stats.mrr.value,
    activeChurches: stats.activeChurches,
    totalChurches: stats.totalChurches,
  };
}

export type GrowthPoint = {
  day: string;
  signups: number;
  activeChurches: number;
  revenue: number;
};

type GrowthRow = {
  day: string;
  signups: string;
  active_churches: string;
  revenue: string;
};

/** 90-day growth series: signups, distinct active churches, revenue per day. */
async function loadGrowthSeries(days = 90): Promise<GrowthPoint[]> {
  const res = await db.execute(sql`
    with days as (
      select generate_series(
        date_trunc('day', now() - make_interval(days => ${days - 1})),
        date_trunc('day', now()),
        interval '1 day'
      )::date as day
    ),
    signups as (
      select created_at::date as day, count(*) as n
      from church
      where created_at >= now() - make_interval(days => ${days})
      group by 1
    ),
    active as (
      select created_at::date as day, count(distinct church_id) as n
      from analytics_event
      where church_id is not null
        and created_at >= now() - make_interval(days => ${days})
      group by 1
    ),
    rev as (
      select coalesce(paid_at, created_at)::date as day, coalesce(sum(amount), 0) as n
      from payment
      where status = 'success'
        and coalesce(paid_at, created_at) >= now() - make_interval(days => ${days})
      group by 1
    )
    select
      to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(s.n, 0) as signups,
      coalesce(a.n, 0) as active_churches,
      coalesce(r.n, 0) as revenue
    from days d
    left join signups s on s.day = d.day
    left join active a on a.day = d.day
    left join rev r on r.day = d.day
    order by d.day
  `);

  return (res.rows as unknown as GrowthRow[]).map((r) => ({
    day: r.day,
    signups: Number(r.signups),
    activeChurches: Number(r.active_churches),
    revenue: Number(r.revenue),
  }));
}

export const getGrowthSeries = unstable_cache(
  loadGrowthSeries,
  ["growth-series"],
  { revalidate: 300, tags: ["platform-stats"] },
);

export type CohortRow = {
  month: string;
  signups: number;
  week4: number | null;
  week8: number | null;
  week12: number | null;
};

/**
 * Of the churches that signed up in a month, what share were still active
 * 4, 8 and 12 weeks later. A cohort too young to have reached a milestone
 * reports null rather than 0% — which would read as total churn.
 */
async function loadCohortRetention(): Promise<CohortRow[]> {
  const res = await db.execute(sql`
    with cohort as (
      select id, date_trunc('month', created_at) as month, created_at
      from church
      where created_at >= now() - interval '12 months'
    ),
    activity as (
      select church_id, created_at from analytics_event where church_id is not null
      union all select church_id, created_at from attendance_session
      union all select church_id, created_at from giving
      union all select church_id, created_at from member
      union all select church_id, created_at from communication_log
      union all select church_id, created_at from media
      union all select church_id, created_at from form
      union all select church_id, created_at from devotional
    )
    select
      to_char(c.month, 'YYYY-MM') as month,
      count(distinct c.id) as signups,
      count(distinct c.id) filter (
        where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '4 weeks'
            and a.created_at <  c.created_at + interval '5 weeks')
      ) as w4,
      count(distinct c.id) filter (
        where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '8 weeks'
            and a.created_at <  c.created_at + interval '9 weeks')
      ) as w8,
      count(distinct c.id) filter (
        where exists (
          select 1 from activity a where a.church_id = c.id
            and a.created_at >= c.created_at + interval '12 weeks'
            and a.created_at <  c.created_at + interval '13 weeks')
      ) as w12,
      min(c.created_at) as first_signup
    from cohort c
    group by c.month
    order by c.month desc
  `);

  const now = Date.now();
  const WEEK = 7 * 86_400_000;

  return (
    res.rows as unknown as {
      month: string;
      signups: string;
      w4: string;
      w8: string;
      w12: string;
      first_signup: string;
    }[]
  ).map((r) => {
    const signups = Number(r.signups);
    const age = now - new Date(r.first_signup).getTime();
    const pct = (n: string, weeks: number): number | null => {
      if (age < weeks * WEEK) return null; // cohort too young to judge
      return signups > 0 ? Math.round((Number(n) / signups) * 100) : null;
    };
    return {
      month: r.month,
      signups,
      week4: pct(r.w4, 5),
      week8: pct(r.w8, 9),
      week12: pct(r.w12, 13),
    };
  });
}

export const getCohortRetention = unstable_cache(
  loadCohortRetention,
  ["cohort-retention"],
  { revalidate: 3600, tags: ["platform-stats"] },
);

export type ChurchPnl = {
  churchId: string;
  revenue: number;
  smsPages: number;
  smsCost: number;
  storageCost: number;
  margin: number;
};

type PnlRow = {
  church_id: string;
  revenue: string;
  sms_pages: string;
  storage_cost: string;
};

/**
 * What each church has paid us versus what it costs to serve. Some churches
 * are certainly unprofitable; without this there is no way to tell which.
 */
async function loadChurchPnl(): Promise<ChurchPnl[]> {
  const unitCost = (await getTermiiUnitCost()) ?? 0;

  const res = await db.execute(sql`
    select
      c.id as church_id,
      coalesce((select sum(p.amount) from payment p
                where p.church_id = c.id and p.status = 'success'), 0)
      + coalesce((select sum(t.amount) from wallet_topup t
                  where t.church_id = c.id and t.status = 'success'), 0) as revenue,
      coalesce((select sum(u.count) from usage_stat u
                where u.church_id = c.id and u.metric = 'sms_pages'), 0) as sms_pages,
      c.storage_monthly_cost as storage_cost
    from church c
  `);

  return (res.rows as unknown as PnlRow[]).map((r) => {
    const revenue = Number(r.revenue);
    const smsPages = Number(r.sms_pages);
    const smsCost = +(smsPages * unitCost).toFixed(2);
    const storageCost = Number(r.storage_cost);
    return {
      churchId: r.church_id,
      revenue,
      smsPages,
      smsCost,
      storageCost,
      margin: +(revenue - smsCost - storageCost).toFixed(2),
    };
  });
}

export const getChurchPnl = unstable_cache(loadChurchPnl, ["church-pnl"], {
  revalidate: 300,
  tags: ["platform-stats"],
});

export type { ChurchHealthRow };
