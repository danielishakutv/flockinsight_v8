import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, usageStat } from "@/db/schema";

/** Increment a daily usage counter for a church. Never throws. */
export async function recordUsage(
  metric: "email" | "sms",
  churchId: string,
  n = 1,
): Promise<void> {
  if (!churchId || n <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  try {
    await db
      .insert(usageStat)
      .values({ churchId, metric, day, count: n })
      .onConflictDoUpdate({
        target: [usageStat.churchId, usageStat.metric, usageStat.day],
        set: { count: sql`${usageStat.count} + ${n}` },
      });
  } catch (e) {
    console.error("[usage] recordUsage failed", e);
  }
}

/** Platform-wide total for a metric, optionally since a day (YYYY-MM-DD). */
export async function metricTotal(
  metric: "email" | "sms",
  sinceDay?: string,
): Promise<number> {
  const where = sinceDay
    ? and(eq(usageStat.metric, metric), gte(usageStat.day, sinceDay))
    : eq(usageStat.metric, metric);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageStat.count}), 0)` })
    .from(usageStat)
    .where(where);
  return Number(row?.total ?? 0);
}

/** Email + SMS totals for one church (all time). */
export async function churchUsage(
  churchId: string,
): Promise<{ email: number; sms: number }> {
  const rows = await db
    .select({
      metric: usageStat.metric,
      total: sql<number>`coalesce(sum(${usageStat.count}), 0)`,
    })
    .from(usageStat)
    .where(eq(usageStat.churchId, churchId))
    .groupBy(usageStat.metric);
  const map = new Map(rows.map((r) => [r.metric, Number(r.total)]));
  return { email: map.get("email") ?? 0, sms: map.get("sms") ?? 0 };
}

/** Email + SMS totals for one church since a given day (YYYY-MM-DD). */
export async function churchUsageSince(
  churchId: string,
  sinceDay: string,
): Promise<{ email: number; sms: number }> {
  const rows = await db
    .select({
      metric: usageStat.metric,
      total: sql<number>`coalesce(sum(${usageStat.count}), 0)`,
    })
    .from(usageStat)
    .where(and(eq(usageStat.churchId, churchId), gte(usageStat.day, sinceDay)))
    .groupBy(usageStat.metric);
  const map = new Map(rows.map((r) => [r.metric, Number(r.total)]));
  return { email: map.get("email") ?? 0, sms: map.get("sms") ?? 0 };
}

/** Top churches by a metric (all time). */
export async function topChurchesByMetric(
  metric: "email" | "sms",
  limit = 5,
): Promise<{ name: string; total: number }[]> {
  const rows = await db
    .select({
      name: church.name,
      total: sql<number>`coalesce(sum(${usageStat.count}), 0)`,
    })
    .from(usageStat)
    .innerJoin(church, eq(church.id, usageStat.churchId))
    .where(eq(usageStat.metric, metric))
    .groupBy(church.name)
    .orderBy(desc(sql`sum(${usageStat.count})`))
    .limit(limit);
  return rows.map((r) => ({ name: r.name, total: Number(r.total) }));
}
