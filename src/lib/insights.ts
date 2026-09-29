import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCohortRetention, getChurchPnl, type CohortRow } from "@/lib/platform-stats";
import { getChurchHealth } from "@/lib/platform-health";
import { getPlanPrices } from "@/lib/pricing";
import type { Sample } from "@/lib/thin-data";

/**
 * The platform's own analytics, each figure carrying the sample it rests on.
 *
 * Nothing here computes anything the rest of the app could not already work
 * out — retention, per-church P&L and health all exist. What is new is that
 * every accessor returns its Sample alongside its rows, so a panel cannot
 * render a number without saying how many churches are behind it.
 */

export type CohortInsight = { rows: CohortRow[]; sample: Sample };

export async function getCohortInsight(): Promise<CohortInsight> {
  const rows = await getCohortRetention();
  const signups = rows.reduce((n, r) => n + r.signups, 0);
  return {
    rows,
    sample: { n: signups, churches: signups, unit: "churches signed up" },
  };
}

export type PlanEconomics = {
  plan: string;
  churches: number;
  price: number;
  revenue: number;
  smsCost: number;
  storageCost: number;
  margin: number;
};

export type EconomicsInsight = {
  rows: PlanEconomics[];
  payingChurches: number;
  sample: Sample;
};

/**
 * What each plan actually earns, after what it costs to serve.
 *
 * Grouped in JS from two existing accessors rather than one clever query: a
 * correlated subquery over these tables is exactly the shape that renders
 * without its table qualifier and returns silent zeroes.
 */
export async function getEconomicsInsight(): Promise<EconomicsInsight> {
  const [pnl, health, prices] = await Promise.all([
    getChurchPnl(),
    getChurchHealth(),
    getPlanPrices(),
  ]);

  const planBy = new Map(health.map((h) => [h.churchId, h.plan]));
  const byPlan = new Map<string, PlanEconomics>();

  for (const row of pnl) {
    const plan = planBy.get(row.churchId) ?? "starter";
    const cur =
      byPlan.get(plan) ??
      ({
        plan,
        churches: 0,
        price: prices[plan as keyof typeof prices] ?? 0,
        revenue: 0,
        smsCost: 0,
        storageCost: 0,
        margin: 0,
      } satisfies PlanEconomics);

    cur.churches += 1;
    cur.revenue += row.revenue;
    cur.smsCost += row.smsCost;
    cur.storageCost += row.storageCost;
    cur.margin += row.margin;
    byPlan.set(plan, cur);
  }

  const rows = [...byPlan.values()].sort((a, b) => b.revenue - a.revenue);
  const payingChurches = pnl.filter((r) => r.revenue > 0).length;
  const payments = rows.reduce((n, r) => n + (r.revenue > 0 ? r.churches : 0), 0);

  return {
    rows,
    payingChurches,
    sample: { n: payments, churches: payingChurches, unit: "paying churches" },
  };
}

export type DemographyInsight = {
  gender: { label: string; value: number }[];
  ageBands: { label: string; value: number }[];
  states: { label: string; value: number }[];
  sample: Sample;
};

type CountRow = { label: string | null; n: string };

/**
 * Who the members are, in aggregate and only in aggregate.
 *
 * No drill-down, and no cut finer than these three. Four hundred members
 * spread across a handful of churches are individually re-identifiable — a
 * cross-tenant browser over other people's congregations is not something this
 * platform should be able to do, however interesting the question.
 *
 * Raw qualified names in the SQL rather than drizzle column refs: a nested
 * template without a join drops the table qualifier, Postgres binds both sides
 * to the inner table, and the count comes back silently zero.
 */
async function loadDemography(): Promise<DemographyInsight> {
  const [genderRows, ageRows, stateRows, totals] = await Promise.all([
    /*
     * `gender` is a Postgres enum, not text, so it must be cast before any
     * string function touches it — `trim(gender)` raises
     * "function pg_catalog.btrim(gender) does not exist" and takes the page
     * with it. An enum value cannot be blank or padded either, so the
     * trim/nullif dance that `state` needs is pointless here.
     */
    db.execute<CountRow>(sql`
      select coalesce(gender::text, 'Not recorded') as label,
             count(*)::text as n
      from member
      group by 1
      order by count(*) desc
    `),
    db.execute<CountRow>(sql`
      select case
               when date_of_birth is null then 'Not recorded'
               when extract(year from age(date_of_birth)) < 13 then 'Under 13'
               when extract(year from age(date_of_birth)) < 20 then '13-19'
               when extract(year from age(date_of_birth)) < 36 then '20-35'
               when extract(year from age(date_of_birth)) < 61 then '36-60'
               else '60+'
             end as label,
             count(*)::text as n
      from member
      group by 1
      order by count(*) desc
    `),
    db.execute<CountRow>(sql`
      select coalesce(nullif(trim(state), ''), 'Not recorded') as label,
             count(*)::text as n
      from member
      group by 1
      order by count(*) desc
      limit 10
    `),
    db.execute<{ members: string; churches: string }>(sql`
      select count(*)::text as members,
             count(distinct church_id)::text as churches
      from member
    `),
  ]);

  const map = (rows: { rows: CountRow[] }) =>
    rows.rows.map((r) => ({ label: r.label ?? "Not recorded", value: Number(r.n) }));

  const t = totals.rows[0];
  return {
    gender: map(genderRows),
    ageBands: map(ageRows),
    states: map(stateRows),
    sample: {
      n: Number(t?.members ?? 0),
      churches: Number(t?.churches ?? 0),
      unit: "members",
    },
  };
}

export const getDemographyInsight = unstable_cache(
  loadDemography,
  ["demography-insight"],
  { revalidate: 900, tags: ["platform-stats"] },
);
