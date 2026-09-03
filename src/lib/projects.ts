import "server-only";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { outstandingOn } from "@/lib/pledge-status";
import { giving, member, pledge, project } from "@/db/schema";
import type {
  PledgeCadence,
  PledgeStatus,
  ProjectStatus,
} from "@/lib/projects-shared";

/* ============================================================
 * Fundraising projects & pledges — read layer.
 *
 * A pledge payment is an ordinary `giving` row tagged with pledgeId (+
 * projectId), so all progress is a live SUM of those rows — nothing cached.
 * Client-safe vocabulary (cadence labels) lives in lib/projects-shared.ts.
 * ========================================================== */

export type { PledgeCadence, PledgeStatus, ProjectStatus };
export { CADENCES, cadenceLabel } from "@/lib/projects-shared";

export type ProjectListItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  targetAmount: number | null;
  raised: number;
  pledged: number;
  pledgeCount: number;
};

/**
 * All projects for a church with raised/pledged rollups.
 *
 * The rollups are grouped queries joined in JS rather than correlated
 * subqueries, for the reason recorded on `paidByPledge` below: inside a raw
 * `sql` template in a SELECT-field position, drizzle renders `${table.column}`
 * WITHOUT its table qualifier. `where ${giving.projectId} = ${project.id}`
 * became `where "project_id" = "id"`, and Postgres resolved both names against
 * the inner table — so every project silently reported zero raised, zero
 * pledged and zero pledges.
 */
export async function listProjects(churchId: string): Promise<ProjectListItem[]> {
  const [rows, raisedRows, pledgedRows] = await Promise.all([
    db
      .select({
        id: project.id,
        name: project.name,
        status: project.status,
        targetAmount: project.targetAmount,
        createdAt: project.createdAt,
      })
      .from(project)
      .where(eq(project.churchId, churchId))
      // Active first, then most recent.
      .orderBy(asc(project.status), desc(project.createdAt)),
    db
      .select({
        projectId: giving.projectId,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .where(eq(giving.churchId, churchId))
      .groupBy(giving.projectId),
    db
      .select({
        projectId: pledge.projectId,
        total: sql<number>`coalesce(sum(${pledge.amount}), 0)`,
        n: count(),
      })
      .from(pledge)
      .where(and(eq(pledge.churchId, churchId), ne(pledge.status, "cancelled")))
      .groupBy(pledge.projectId),
  ]);

  const raisedOf = new Map(raisedRows.map((r) => [r.projectId, Number(r.total)]));
  const pledgedOf = new Map(
    pledgedRows.map((r) => [r.projectId, { total: Number(r.total), n: Number(r.n) }]),
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    targetAmount: r.targetAmount,
    raised: raisedOf.get(r.id) ?? 0,
    pledged: pledgedOf.get(r.id)?.total ?? 0,
    pledgeCount: pledgedOf.get(r.id)?.n ?? 0,
  }));
}

export type PledgeRow = {
  id: string;
  memberId: string | null;
  giverName: string | null;
  name: string;
  amount: number;
  paid: number;
  cadence: PledgeCadence;
  cadenceLabel: string | null;
  installmentAmount: number | null;
  status: PledgeStatus;
  startDate: string | null;
  note: string | null;
};

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  targetAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  raised: number;
  pledged: number;
  pledges: PledgeRow[];
};

/** A project with its pledges (each with amount paid so far), or null. */
export async function getProject(
  churchId: string,
  id: string,
): Promise<ProjectDetail | null> {
  const [p] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.churchId, churchId)))
    .limit(1);
  if (!p) return null;

  const pledges = await db
    .select({
      id: pledge.id,
      memberId: pledge.memberId,
      giverName: pledge.giverName,
      firstName: member.firstName,
      lastName: member.lastName,
      amount: pledge.amount,
      cadence: pledge.cadence,
      cadenceLabel: pledge.cadenceLabel,
      installmentAmount: pledge.installmentAmount,
      status: pledge.status,
      startDate: pledge.startDate,
      note: pledge.note,
      createdAt: pledge.createdAt,
    })
    .from(pledge)
    .leftJoin(member, eq(member.id, pledge.memberId))
    .where(and(eq(pledge.projectId, id), eq(pledge.churchId, churchId)))
    .orderBy(asc(pledge.status), desc(pledge.createdAt));

  // Same reason as listProjects: a correlated subquery here reported every
  // pledge as unpaid. `paidByPledge` groups instead, so it cannot misbind.
  const paidOf = await paidByPledge(
    churchId,
    pledges.map((r) => r.id),
  );

  const [totals] = await db
    .select({
      raised: sql<number>`coalesce(sum(${giving.amount}), 0)`,
    })
    .from(giving)
    .where(and(eq(giving.projectId, id), eq(giving.churchId, churchId)));

  const pledgeRows: PledgeRow[] = pledges.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    giverName: r.giverName,
    name:
      [r.firstName, r.lastName].filter(Boolean).join(" ") ||
      r.giverName ||
      "Unnamed",
    amount: Number(r.amount),
    paid: paidOf.get(r.id) ?? 0,
    cadence: r.cadence,
    cadenceLabel: r.cadenceLabel,
    installmentAmount: r.installmentAmount,
    status: r.status,
    startDate: r.startDate,
    note: r.note,
  }));

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    targetAmount: p.targetAmount,
    startDate: p.startDate,
    endDate: p.endDate,
    raised: Number(totals?.raised ?? 0),
    pledged: pledgeRows
      .filter((pl) => pl.status !== "cancelled")
      .reduce((a, pl) => a + pl.amount, 0),
    pledges: pledgeRows,
  };
}

/** Active projects (id + name) for pickers, e.g. the giving form. */
export async function activeProjectOptions(
  churchId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.churchId, churchId), eq(project.status, "active")))
    .orderBy(asc(project.name));
}

/**
 * Sum of payments per pledge id, as a plain map.
 *
 * Grouped rather than correlated on purpose. A correlated subquery written as
 * a raw `sql` template in a SELECT-field position loses its table qualifier —
 * drizzle renders `${giving.pledgeId} = ${pledge.id}` as `"pledge_id" = "id"`,
 * both of which Postgres then resolves against `giving`, so the condition is
 * never true and every total comes back zero. Grouping has no outer reference
 * to lose.
 */
export async function paidByPledge(
  churchId: string,
  pledgeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (pledgeIds.length === 0) return map;
  const rows = await db
    .select({
      pledgeId: giving.pledgeId,
      paid: sql<number>`coalesce(sum(${giving.amount}), 0)`,
    })
    .from(giving)
    .where(and(eq(giving.churchId, churchId), inArray(giving.pledgeId, pledgeIds)))
    .groupBy(giving.pledgeId);
  for (const r of rows) if (r.pledgeId) map.set(r.pledgeId, Number(r.paid));
  return map;
}

export type OutstandingPledge = {
  id: string;
  memberId: string | null;
  name: string;
  projectId: string;
  projectName: string;
  amount: number;
  paid: number;
  outstanding: number;
  cadence: PledgeCadence;
  cadenceLabel: string | null;
  status: PledgeStatus;
};

export type PledgeReport = {
  rows: OutstandingPledge[];
  totalPledged: number;
  totalPaid: number;
  totalOutstanding: number;
};

/**
 * Church-wide pledges with what's still owed. By default only active pledges
 * with a balance remaining; pass `includeSettled` for everything. Optionally
 * scope to one project.
 */
export async function getOutstandingPledges(
  churchId: string,
  opts: { projectId?: string; includeSettled?: boolean } = {},
): Promise<PledgeReport> {
  const where = [eq(pledge.churchId, churchId)];
  if (opts.projectId) where.push(eq(pledge.projectId, opts.projectId));
  if (!opts.includeSettled) where.push(eq(pledge.status, "active"));

  const rows = await db
    .select({
      id: pledge.id,
      memberId: pledge.memberId,
      giverName: pledge.giverName,
      firstName: member.firstName,
      lastName: member.lastName,
      projectId: pledge.projectId,
      projectName: project.name,
      amount: pledge.amount,
      cadence: pledge.cadence,
      cadenceLabel: pledge.cadenceLabel,
      status: pledge.status,
      createdAt: pledge.createdAt,
    })
    .from(pledge)
    .innerJoin(project, eq(project.id, pledge.projectId))
    .leftJoin(member, eq(member.id, pledge.memberId))
    .where(and(...where))
    .orderBy(asc(project.name), desc(pledge.createdAt));

  const paid = await paidByPledge(
    churchId,
    rows.map((r) => r.id),
  );

  let all: OutstandingPledge[] = rows.map((r) => {
    const paidAmt = paid.get(r.id) ?? 0;
    return {
      id: r.id,
      memberId: r.memberId,
      name:
        [r.firstName, r.lastName].filter(Boolean).join(" ") ||
        r.giverName ||
        "Unnamed",
      projectId: r.projectId,
      projectName: r.projectName,
      amount: Number(r.amount),
      paid: paidAmt,
      outstanding: outstandingOn(Number(r.amount), paidAmt),
      cadence: r.cadence,
      cadenceLabel: r.cadenceLabel,
      status: r.status,
    };
  });

  // Default view: only those still owing.
  if (!opts.includeSettled) all = all.filter((r) => r.outstanding > 0);

  return {
    rows: all,
    totalPledged: all.reduce((a, r) => a + r.amount, 0),
    totalPaid: all.reduce((a, r) => a + r.paid, 0),
    totalOutstanding: all.reduce((a, r) => a + r.outstanding, 0),
  };
}

export type MemberPledge = {
  id: string;
  projectId: string;
  projectName: string;
  amount: number;
  paid: number;
  outstanding: number;
  cadence: PledgeCadence;
  cadenceLabel: string | null;
  status: PledgeStatus;
};

/** All of one member's pledges across projects (their personal statement). */
export async function getMemberPledges(
  churchId: string,
  memberId: string,
): Promise<MemberPledge[]> {
  const rows = await db
    .select({
      id: pledge.id,
      projectId: pledge.projectId,
      projectName: project.name,
      amount: pledge.amount,
      cadence: pledge.cadence,
      cadenceLabel: pledge.cadenceLabel,
      status: pledge.status,
      createdAt: pledge.createdAt,
    })
    .from(pledge)
    .innerJoin(project, eq(project.id, pledge.projectId))
    .where(and(eq(pledge.churchId, churchId), eq(pledge.memberId, memberId)))
    .orderBy(asc(pledge.status), desc(pledge.createdAt));

  const paid = await paidByPledge(
    churchId,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const paidAmt = paid.get(r.id) ?? 0;
    return {
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      amount: Number(r.amount),
      paid: paidAmt,
      outstanding: Math.max(0, Number(r.amount) - paidAmt),
      cadence: r.cadence,
      cadenceLabel: r.cadenceLabel,
      status: r.status,
    };
  });
}
