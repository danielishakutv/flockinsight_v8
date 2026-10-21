import "server-only";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { parseISO } from "date-fns";
import { db } from "@/db";
import { attendanceSession, giving, member } from "@/db/schema";
import { getAnchoredWeeklySeries, growthPct, weeklyAverage } from "@/lib/attendance-metrics";
import { getMemberBreakdown, getModuleHighlights, getRegistrationTrend } from "@/lib/dashboard-data";
import type { ChurchFactsRaw } from "./church-facts-shared";

/*
 * Reads the plain numbers a church summary is built from. Every query is
 * scoped with eq(x.churchId, churchId), every aggregate is wrapped in Number()
 * (pg returns count and sum as strings), and none of them is a correlated
 * subquery, so the raw-sql qualifier trap cannot apply.
 *
 * Nothing here reads a name: not a member's, not a service's, not a giving
 * category's. Service averages are kept as bare numbers.
 */

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBefore(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

export async function loadChurchFactsRaw(churchId: string): Promise<ChurchFactsRaw> {
  const now = new Date();
  const since90 = daysBefore(now, 90);
  const d90 = iso(since90);

  // Six COMPLETE months before this one. The current month is month-to-date,
  // and comparing it with a whole month would make every church look like its
  // giving collapsed for the first three weeks of every month.
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const [{ series, endDate, anchored }, breakdown, registrations, highlights] = await Promise.all([
    getAnchoredWeeklySeries(churchId, 12),
    getMemberBreakdown(churchId),
    getRegistrationTrend(churchId, 6),
    getModuleHighlights(churchId, since90),
  ]);
  const windowStart = iso(daysBefore(parseISO(endDate), 7 * 12));

  const monthBucket = sql<string>`to_char(date_trunc('month', ${giving.date}), 'YYYY-MM')`;

  const [serviceRows, givingRows, [ft]] = await Promise.all([
    // (a) average headcount per service over the same 12-week window.
    db
      .select({ avg: sql<string>`avg(${attendanceSession.totalCount})` })
      .from(attendanceSession)
      .where(
        and(
          eq(attendanceSession.churchId, churchId),
          gte(attendanceSession.date, windowStart),
          lte(attendanceSession.date, endDate),
        ),
      )
      .groupBy(attendanceSession.serviceId),
    // (b) giving per complete month. The sums never leave: only their index does.
    db
      .select({ month: monthBucket, total: sql<string>`coalesce(sum(${giving.amount}), 0)` })
      .from(giving)
      .where(and(eq(giving.churchId, churchId), gte(giving.date, iso(sixAgo)), lt(giving.date, iso(thisMonth))))
      .groupBy(monthBucket),
    // (c) first-timers in 90 days, and the follow-up stages.
    db
      .select({
        registered90d: sql<string>`count(*) filter (where ${member.firstVisitDate} >= ${d90})`,
        // "Became a member" means active, or marked joined by follow-up.
        // new_convert is not membership.
        becameMember90d: sql<string>`count(*) filter (where ${member.firstVisitDate} >= ${d90} and (${member.status} = 'active' or ${member.followUpStatus} = 'joined'))`,
        fuNew: sql<string>`count(*) filter (where ${member.followUpStatus} = 'new')`,
        fuContacted: sql<string>`count(*) filter (where ${member.followUpStatus} = 'contacted')`,
        fuInProgress: sql<string>`count(*) filter (where ${member.followUpStatus} = 'in_progress')`,
        fuJoined: sql<string>`count(*) filter (where ${member.followUpStatus} = 'joined')`,
        fuNotInterested: sql<string>`count(*) filter (where ${member.followUpStatus} = 'not_interested')`,
      })
      .from(member)
      .where(eq(member.churchId, churchId)),
  ]);

  const byMonth = new Map(givingRows.map((r) => [r.month, Number(r.total)]));
  const givingMonthlySums: number[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixAgo.getFullYear(), sixAgo.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    givingMonthlySums.push(byMonth.get(key) ?? 0);
  }

  return {
    anchored,
    weeks: series.map((w) => ({
      total: w.total,
      male: w.male,
      female: w.female,
      teens: w.teens,
      children: w.children,
      firstTimers: w.firstTimers,
      newConverts: w.newConverts,
      count: w.count,
    })),
    weeklyAverage8: weeklyAverage(series, 8),
    growthPct4: growthPct(series, 4),
    serviceAverages: serviceRows.map((r) => Number(r.avg ?? 0)),
    people: {
      total: breakdown.total,
      active: breakdown.active,
      inactive: breakdown.inactive,
      visitors: breakdown.visitors,
      newConverts: breakdown.newConverts,
      withPhone: breakdown.withPhone,
      withEmail: breakdown.withEmail,
    },
    registeredByMonth: registrations.points.map((p) => p.people),
    firstTimers: {
      registered90d: Number(ft?.registered90d ?? 0),
      becameMember90d: Number(ft?.becameMember90d ?? 0),
      followUpNew: Number(ft?.fuNew ?? 0),
      followUpContacted: Number(ft?.fuContacted ?? 0),
      followUpInProgress: Number(ft?.fuInProgress ?? 0),
      followUpJoined: Number(ft?.fuJoined ?? 0),
      followUpNotInterested: Number(ft?.fuNotInterested ?? 0),
    },
    givingMonthlySums,
    highlights: {
      groups: highlights.groups,
      followUpOpen: highlights.followUpOpen,
      upcomingEvents: highlights.upcomingEvents,
      formResponses: highlights.formResponses,
      subscribers: highlights.subscribers,
    },
  };
}
