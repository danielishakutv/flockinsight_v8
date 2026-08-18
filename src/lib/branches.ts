import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceSession,
  branchRequest,
  church,
  giving,
  hqReportSetting,
  member,
  staff,
  user,
} from "@/db/schema";
import {
  rangeStart,
  ALL,
  type BranchFilters,
  type BranchStat,
  type RangeKey,
} from "@/lib/branches-shared";

/* ============================================================
 * A headquarters and its branches.
 *
 * Branches are ordinary churches: their own plan, their own data, their own
 * logins. The link is one column (church.parentChurchId) and it grants the
 * headquarters exactly one thing — the ability to read roll-up numbers.
 * Nothing here ever writes to a branch's data.
 * ========================================================== */

/** The churches reporting to this headquarters, in name order. */
export async function branchesOf(parentChurchId: string) {
  return db
    .select({
      id: church.id,
      name: church.name,
      zone: church.zone,
      city: church.city,
      state: church.state,
      country: church.country,
      currency: church.currency,
      plan: church.plan,
      status: church.status,
      createdAt: church.createdAt,
    })
    .from(church)
    .where(eq(church.parentChurchId, parentChurchId))
    .orderBy(asc(church.name));
}

export async function branchCount(parentChurchId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(church)
    .where(eq(church.parentChurchId, parentChurchId));
  return Number(row?.c ?? 0);
}

/** The headquarters this church reports to, if any. */
export async function headquartersOf(childChurchId: string) {
  const [child] = await db
    .select({ parentId: church.parentChurchId })
    .from(church)
    .where(eq(church.id, childChurchId))
    .limit(1);
  if (!child?.parentId) return null;

  const [parent] = await db
    .select({ id: church.id, name: church.name, handle: church.handle })
    .from(church)
    .where(eq(church.id, child.parentId))
    .limit(1);
  return parent ?? null;
}

export type FilterOptions = {
  zones: string[];
  states: string[];
  cities: string[];
  countries: string[];
};

type BranchRow = Awaited<ReturnType<typeof branchesOf>>[number];

function filterOptions(branches: BranchRow[]): FilterOptions {
  const uniq = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => !!v && v.trim() !== ""))].sort();
  return {
    zones: uniq(branches.map((b) => b.zone)),
    states: uniq(branches.map((b) => b.state)),
    cities: uniq(branches.map((b) => b.city)),
    countries: uniq(branches.map((b) => b.country)),
  };
}

function matchesFilters(b: BranchRow, f: BranchFilters): boolean {
  if (f.zone !== ALL && (b.zone ?? "") !== f.zone) return false;
  if (f.state !== ALL && (b.state ?? "") !== f.state) return false;
  if (f.city !== ALL && (b.city ?? "") !== f.city) return false;
  if (f.country !== ALL && b.country !== f.country) return false;
  if (f.q) {
    const hay =
      `${b.name} ${b.city ?? ""} ${b.state ?? ""} ${b.zone ?? ""}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/**
 * Every number the headquarters dashboard shows, for one date range — four
 * grouped queries rather than four per branch.
 */
export async function branchStats(
  parentChurchId: string,
  filters: BranchFilters,
): Promise<{ rows: BranchStat[]; options: FilterOptions }> {
  const branches = await branchesOf(parentChurchId);
  const options = filterOptions(branches);
  const matching = branches.filter((b) => matchesFilters(b, filters));
  const ids = matching.map((b) => b.id);
  if (ids.length === 0) return { rows: [], options };

  const since = rangeStart(filters.range);
  const sinceDate = since.toISOString().slice(0, 10);

  const [memberRows, newMemberRows, attendanceRows, givingRows] =
    await Promise.all([
      db
        .select({ churchId: member.churchId, c: sql<number>`count(*)::int` })
        .from(member)
        .where(inArray(member.churchId, ids))
        .groupBy(member.churchId),
      db
        .select({ churchId: member.churchId, c: sql<number>`count(*)::int` })
        .from(member)
        .where(and(inArray(member.churchId, ids), gte(member.createdAt, since)))
        .groupBy(member.churchId),
      db
        .select({
          churchId: attendanceSession.churchId,
          sessions: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${attendanceSession.totalCount}), 0)::int`,
          last: sql<string | null>`max(${attendanceSession.date})`,
        })
        .from(attendanceSession)
        .where(
          and(
            inArray(attendanceSession.churchId, ids),
            gte(attendanceSession.date, sinceDate),
          ),
        )
        .groupBy(attendanceSession.churchId),
      db
        .select({
          churchId: giving.churchId,
          total: sql<string>`coalesce(sum(${giving.amount}), 0)`,
        })
        .from(giving)
        .where(and(inArray(giving.churchId, ids), gte(giving.date, sinceDate)))
        .groupBy(giving.churchId),
    ]);

  const members = new Map(memberRows.map((r) => [r.churchId, Number(r.c)]));
  const newMembers = new Map(newMemberRows.map((r) => [r.churchId, Number(r.c)]));
  const attendance = new Map(attendanceRows.map((r) => [r.churchId, r]));
  const givings = new Map(givingRows.map((r) => [r.churchId, Number(r.total)]));

  const rows: BranchStat[] = matching.map((b) => {
    const att = attendance.get(b.id);
    const sessions = Number(att?.sessions ?? 0);
    const total = Number(att?.total ?? 0);
    return {
      churchId: b.id,
      name: b.name,
      zone: b.zone,
      city: b.city,
      state: b.state,
      country: b.country,
      currency: b.currency,
      members: members.get(b.id) ?? 0,
      newMembers: newMembers.get(b.id) ?? 0,
      services: sessions,
      attendanceTotal: total,
      attendanceAvg: sessions ? Math.round(total / sessions) : 0,
      giving: givings.get(b.id) ?? 0,
      lastActivity: att?.last ?? null,
    };
  });

  return { rows, options };
}

/** The roll-up across whatever the filters left. */
export function rollUp(rows: BranchStat[]) {
  return rows.reduce(
    (acc, r) => ({
      branches: acc.branches + 1,
      members: acc.members + r.members,
      newMembers: acc.newMembers + r.newMembers,
      services: acc.services + r.services,
      attendanceTotal: acc.attendanceTotal + r.attendanceTotal,
      giving: acc.giving + r.giving,
    }),
    {
      branches: 0,
      members: 0,
      newMembers: 0,
      services: 0,
      attendanceTotal: 0,
      giving: 0,
    },
  );
}

/* ------------------------------------------------------------------ *
 * Linking
 * ------------------------------------------------------------------ */

/** Requests this church has sent (as HQ) or received (as a would-be branch). */
export async function branchRequests(churchId: string) {
  const [sent, received] = await Promise.all([
    db
      .select({
        id: branchRequest.id,
        status: branchRequest.status,
        message: branchRequest.message,
        createdAt: branchRequest.createdAt,
        inviteEmail: branchRequest.inviteEmail,
        churchId: church.id,
        churchName: church.name,
      })
      .from(branchRequest)
      .leftJoin(church, eq(church.id, branchRequest.childChurchId))
      .where(eq(branchRequest.parentChurchId, churchId))
      .orderBy(desc(branchRequest.createdAt))
      .limit(50),
    db
      .select({
        id: branchRequest.id,
        status: branchRequest.status,
        message: branchRequest.message,
        createdAt: branchRequest.createdAt,
        churchId: church.id,
        churchName: church.name,
        city: church.city,
      })
      .from(branchRequest)
      .innerJoin(church, eq(church.id, branchRequest.parentChurchId))
      .where(
        and(
          eq(branchRequest.childChurchId, churchId),
          eq(branchRequest.status, "pending"),
        ),
      )
      .orderBy(desc(branchRequest.createdAt))
      .limit(20),
  ]);
  return { sent, received };
}

/**
 * Churches a headquarters could invite: on FlockInsight, not already in a
 * network, and not itself. Matched on name, handle or a login's email.
 */
export async function searchLinkableChurches(churchId: string, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

  return db
    .selectDistinct({
      id: church.id,
      name: church.name,
      city: church.city,
      state: church.state,
      handle: church.handle,
    })
    .from(church)
    .leftJoin(staff, eq(staff.organizationId, church.id))
    .leftJoin(user, eq(user.id, staff.userId))
    .where(
      and(
        isNull(church.parentChurchId),
        sql`${church.id} <> ${churchId}`,
        or(
          sql`${church.name} ilike ${like}`,
          sql`${church.handle} ilike ${like}`,
          sql`${user.email} ilike ${like}`,
        ),
      ),
    )
    .orderBy(asc(church.name))
    .limit(15);
}

/* ------------------------------------------------------------------ *
 * Scheduled reports
 * ------------------------------------------------------------------ */

export async function getReportSetting(churchId: string) {
  const [row] = await db
    .select()
    .from(hqReportSetting)
    .where(eq(hqReportSetting.churchId, churchId))
    .limit(1);
  return row ?? null;
}

/** Everyone with a login at this church — the default report recipients. */
export async function churchTeamEmails(churchId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ email: user.email })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(eq(staff.organizationId, churchId));
  return rows.map((r) => r.email);
}

/** Headquarters whose scheduled report is due, for the cron to work through. */
export async function dueReportSettings(now = new Date()) {
  const rows = await db
    .select({
      churchId: hqReportSetting.churchId,
      frequency: hqReportSetting.frequency,
      recipients: hqReportSetting.recipients,
      lastSentAt: hqReportSetting.lastSentAt,
      churchName: church.name,
      currency: church.currency,
    })
    .from(hqReportSetting)
    .innerJoin(church, eq(church.id, hqReportSetting.churchId))
    .where(and(eq(hqReportSetting.enabled, true), eq(church.status, "active")));

  return rows.filter((r) => {
    if (!r.lastSentAt) return true;
    const gapDays = (now.getTime() - r.lastSentAt.getTime()) / 86_400_000;
    // A day of slack either side, so a cron that runs late still counts.
    return r.frequency === "weekly" ? gapDays >= 6.5 : gapDays >= 27.5;
  });
}

export const REPORT_RANGE: Record<"weekly" | "monthly", RangeKey> = {
  weekly: "30d",
  monthly: "mtd",
};
