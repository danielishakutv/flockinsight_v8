import "server-only";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceSession,
  communicationLog,
  giving,
  givingCategory,
  group,
  groupMembership,
  member,
  service,
} from "@/db/schema";
import type { ReportRange } from "@/lib/report-range";

/**
 * The figures on the front of the data report.
 *
 * This exists because of what that report used to be. It printed four headline
 * tiles and then, for three pages, a database schema: every table, its row
 * count, its "grain", and lines reading
 *
 *     Joins: household_id -> households.household_id
 *
 * which is a note from one programme to another. A pastor opened it looking
 * for what the church gave last quarter and found foreign keys. The row counts
 * did answer one real question — "is this module empty?" — so a short version
 * of that survives at the back, in words, without the keys.
 *
 * Everything here is a real number about the church: what came in and under
 * which heading, who turned up and to what, how the roll moved month by month.
 * The CSVs remain the thing you hand to an analyst; this is the thing you hand
 * to a board.
 *
 * ON DATE RANGES, which this report has been wrong about before: a figure
 * either describes something that HAPPENED, and follows the range, or
 * something that IS, and cannot. Giving, attendance, messages and new members
 * are the first kind. The member roll, its statuses and group sizes are the
 * second — "how many groups between January and March" has no honest answer —
 * so they are labelled "today" and left unfiltered. `getChurchTotals` splits
 * its tiles on the same line; keep the two in step.
 */

export type GivingByCategory = {
  name: string;
  entries: number;
  total: number;
  /** 0–100, of the giving inside the range. */
  share: number;
};

export type AttendanceByService = {
  name: string;
  sessions: number;
  average: number;
  best: number;
};

export type MonthRow = {
  /** "2026-03" */
  month: string;
  services: number;
  average: number;
  newMembers: number;
  giving: number;
};

export type GroupSize = { name: string; members: number };

export type StatusCount = { status: string; members: number };

export type ChannelRow = {
  channel: string;
  sends: number;
  recipients: number;
  reached: number;
  failed: number;
  skipped: number;
  cost: number;
};

export type AttendanceMix = {
  adults: number;
  teens: number;
  youths: number;
  seniors: number;
  children: number;
  firstTimers: number;
  newConverts: number;
};

export type SummaryInsights = {
  givingByCategory: GivingByCategory[];
  attendanceByService: AttendanceByService[];
  attendanceMix: AttendanceMix;
  months: MonthRow[];
  groups: GroupSize[];
  statuses: StatusCount[];
  channels: ChannelRow[];
  /**
   * How many rows each table left out, so the page can say so.
   *
   * A table that quietly stops at ten reads as the whole truth — a church with
   * fourteen giving categories would see four of them vanish and have no way
   * to tell that from four that were never recorded. Every table that can be
   * cut reports its own remainder here.
   */
  omitted: {
    givingCategories: number;
    services: number;
    groups: number;
    months: number;
  };
  /** True when every section came back empty, so the report can say so plainly. */
  empty: boolean;
};

/** How many rows of each table the page has room for. */
const TOP_N = 10;
/** A year of months fits; more and the table runs past a page on its own. */
const MAX_MONTHS = 14;

const num = (v: unknown): number => Number(v ?? 0);

/** "2026-03" into "Mar 2026". Month names only, so no timezone is involved. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const name = MONTHS[Number(m) - 1];
  return name ? `${name} ${y}` : key;
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Active members",
  inactive: "Inactive",
  visitor: "Visitors",
  new_convert: "New converts",
};

export const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  notification: "In-app notice",
};

export async function getSummaryInsights(
  churchId: string,
  range: ReportRange = { from: null, to: null },
): Promise<SummaryInsights> {
  const givingBounds = [];
  if (range.from) givingBounds.push(gte(giving.date, range.from));
  if (range.to) givingBounds.push(lte(giving.date, range.to));
  const givingWhere = and(eq(giving.churchId, churchId), ...givingBounds);

  const sessionBounds = [];
  if (range.from) sessionBounds.push(gte(attendanceSession.date, range.from));
  if (range.to) sessionBounds.push(lte(attendanceSession.date, range.to));
  const sessionWhere = and(
    eq(attendanceSession.churchId, churchId),
    ...sessionBounds,
  );

  const messageBounds = [];
  if (range.from)
    messageBounds.push(
      gte(communicationLog.createdAt, new Date(`${range.from}T00:00:00.000Z`)),
    );
  // End of day, not start, or a range ending today drops everything sent today.
  if (range.to)
    messageBounds.push(
      lte(communicationLog.createdAt, new Date(`${range.to}T23:59:59.999Z`)),
    );
  const messageWhere = and(
    eq(communicationLog.churchId, churchId),
    ...messageBounds,
  );

  /*
   * New members follow the range on the date the church says they joined,
   * falling back to when the row was created for anyone imported before that
   * field was filled in. The monthly series below uses the same expression, so
   * the two can never disagree about which month a person landed in.
   */
  const joinedOn = sql`coalesce(${member.joinedAt}, ${member.createdAt}::date)`;
  const memberBounds = [];
  if (range.from) memberBounds.push(gte(joinedOn, range.from));
  if (range.to) memberBounds.push(lte(joinedOn, range.to));

  const monthOfSession = sql<string>`to_char(${attendanceSession.date}, 'YYYY-MM')`;
  const monthOfGiving = sql<string>`to_char(${giving.date}, 'YYYY-MM')`;
  const monthOfJoin = sql<string>`to_char(coalesce(${member.joinedAt}, ${member.createdAt}::date), 'YYYY-MM')`;

  const [
    byCategory,
    byService,
    mix,
    sessionMonths,
    givingMonths,
    joinMonths,
    groupRows,
    statusRows,
    channelRows,
  ] = await Promise.all([
    // Giving by heading. A left join, so gifts whose category was later
    // deleted still appear rather than vanishing from a total the headline
    // tile already counts.
    db
      .select({
        name: givingCategory.name,
        entries: count(),
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .where(givingWhere)
      .groupBy(givingCategory.name)
      .orderBy(desc(sql`coalesce(sum(${giving.amount}), 0)`)),

    // Attendance by service. `title` carries the one-off sessions that belong
    // to no service, which is why this coalesces rather than inner-joining.
    db
      .select({
        name: sql<
          string | null
        >`coalesce(${service.name}, ${attendanceSession.title})`,
        sessions: count(),
        average: sql<number>`coalesce(round(avg(${attendanceSession.totalCount})), 0)`,
        best: sql<number>`coalesce(max(${attendanceSession.totalCount}), 0)`,
      })
      .from(attendanceSession)
      .leftJoin(service, eq(service.id, attendanceSession.serviceId))
      .where(sessionWhere)
      .groupBy(sql`coalesce(${service.name}, ${attendanceSession.title})`)
      .orderBy(desc(count())),

    db
      .select({
        adults: sql<number>`coalesce(sum(${attendanceSession.maleCount} + ${attendanceSession.femaleCount}), 0)`,
        teens: sql<number>`coalesce(sum(${attendanceSession.teenMaleCount} + ${attendanceSession.teenFemaleCount}), 0)`,
        youths: sql<number>`coalesce(sum(${attendanceSession.youthMaleCount} + ${attendanceSession.youthFemaleCount}), 0)`,
        seniors: sql<number>`coalesce(sum(${attendanceSession.seniorMaleCount} + ${attendanceSession.seniorFemaleCount}), 0)`,
        children: sql<number>`coalesce(sum(${attendanceSession.childrenCount}), 0)`,
        firstTimers: sql<number>`coalesce(sum(${attendanceSession.firstTimerCount}), 0)`,
        newConverts: sql<number>`coalesce(sum(${attendanceSession.newConvertCount}), 0)`,
      })
      .from(attendanceSession)
      .where(sessionWhere),

    db
      .select({
        month: monthOfSession,
        services: count(),
        average: sql<number>`coalesce(round(avg(${attendanceSession.totalCount})), 0)`,
      })
      .from(attendanceSession)
      .where(sessionWhere)
      .groupBy(monthOfSession),

    db
      .select({
        month: monthOfGiving,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .where(givingWhere)
      .groupBy(monthOfGiving),

    db
      .select({ month: monthOfJoin, members: count() })
      .from(member)
      .where(and(eq(member.churchId, churchId), ...memberBounds))
      .groupBy(monthOfJoin),

    // Group sizes are a fact about today, so no range. Left-joined, because an
    // inner join would hide an empty group — which is exactly the group a
    // leader needs to see.
    db
      .select({ name: group.name, members: count(groupMembership.id) })
      .from(group)
      .leftJoin(groupMembership, eq(groupMembership.groupId, group.id))
      .where(eq(group.churchId, churchId))
      .groupBy(group.id, group.name)
      .orderBy(desc(count(groupMembership.id))),

    db
      .select({ status: member.status, members: count() })
      .from(member)
      .where(eq(member.churchId, churchId))
      .groupBy(member.status),

    db
      .select({
        channel: communicationLog.channel,
        sends: count(),
        recipients: sql<number>`coalesce(sum(${communicationLog.recipients}), 0)`,
        reached: sql<number>`coalesce(sum(${communicationLog.sent}), 0)`,
        failed: sql<number>`coalesce(sum(${communicationLog.failed}), 0)`,
        skipped: sql<number>`coalesce(sum(${communicationLog.skipped}), 0)`,
        cost: sql<number>`coalesce(sum(${communicationLog.cost}), 0)`,
      })
      .from(communicationLog)
      .where(messageWhere)
      .groupBy(communicationLog.channel),
  ]);

  const givingTotal = byCategory.reduce((a, r) => a + num(r.total), 0);

  const givingByCategory: GivingByCategory[] = byCategory
    .slice(0, TOP_N)
    .map((r) => ({
      name: r.name ?? "Uncategorised",
      entries: num(r.entries),
      total: num(r.total),
      share: givingTotal > 0 ? (num(r.total) / givingTotal) * 100 : 0,
    }));

  const attendanceByService: AttendanceByService[] = byService
    .slice(0, TOP_N)
    .map((r) => ({
      name: r.name ?? "Other sessions",
      sessions: num(r.sessions),
      average: num(r.average),
      best: num(r.best),
    }));

  /*
   * The three monthly series are merged here rather than with a full outer
   * join in SQL: a month that has giving but no service, or members but
   * neither, is ordinary and not an error, and three outer joins to express
   * that reads far worse than a Map does.
   */
  const monthKeys = new Set<string>();
  for (const r of sessionMonths) monthKeys.add(r.month);
  for (const r of givingMonths) monthKeys.add(r.month);
  for (const r of joinMonths) monthKeys.add(r.month);

  const sessionByMonth = new Map(sessionMonths.map((r) => [r.month, r]));
  const givingByMonth = new Map(givingMonths.map((r) => [r.month, r]));
  const joinsByMonth = new Map(joinMonths.map((r) => [r.month, r]));

  const allMonths = [...monthKeys].sort();

  const months: MonthRow[] = allMonths
    // Keep the most recent months when there are too many, then read forwards
    // again — cutting from the front would bury what just happened.
    .slice(-MAX_MONTHS)
    .map((month) => ({
      month,
      services: num(sessionByMonth.get(month)?.services),
      average: num(sessionByMonth.get(month)?.average),
      newMembers: num(joinsByMonth.get(month)?.members),
      giving: num(givingByMonth.get(month)?.total),
    }));

  const groups: GroupSize[] = groupRows
    .slice(0, TOP_N)
    .map((r) => ({ name: r.name, members: num(r.members) }));

  const statuses: StatusCount[] = statusRows
    .map((r) => ({ status: r.status, members: num(r.members) }))
    .sort((a, b) => b.members - a.members);

  const channels: ChannelRow[] = channelRows.map((r) => ({
    channel: r.channel,
    sends: num(r.sends),
    recipients: num(r.recipients),
    reached: num(r.reached),
    failed: num(r.failed),
    skipped: num(r.skipped),
    cost: num(r.cost),
  }));

  const m = mix[0];
  const attendanceMix: AttendanceMix = {
    adults: num(m?.adults),
    teens: num(m?.teens),
    youths: num(m?.youths),
    seniors: num(m?.seniors),
    children: num(m?.children),
    firstTimers: num(m?.firstTimers),
    newConverts: num(m?.newConverts),
  };

  return {
    givingByCategory,
    attendanceByService,
    attendanceMix,
    months,
    groups,
    statuses,
    channels,
    omitted: {
      givingCategories: Math.max(0, byCategory.length - givingByCategory.length),
      services: Math.max(0, byService.length - attendanceByService.length),
      groups: Math.max(0, groupRows.length - groups.length),
      months: Math.max(0, allMonths.length - months.length),
    },
    empty:
      givingByCategory.length === 0 &&
      attendanceByService.length === 0 &&
      months.length === 0 &&
      groups.length === 0 &&
      statuses.length === 0 &&
      channels.length === 0,
  };
}
