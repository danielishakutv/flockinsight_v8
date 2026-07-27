import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
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

/** All projects for a church with raised/pledged rollups. */
export async function listProjects(churchId: string): Promise<ProjectListItem[]> {
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      status: project.status,
      targetAmount: project.targetAmount,
      createdAt: project.createdAt,
      raised: sql<number>`coalesce((
        select sum(${giving.amount}) from ${giving}
        where ${giving.projectId} = ${project.id}
      ), 0)`,
      pledged: sql<number>`coalesce((
        select sum(${pledge.amount}) from ${pledge}
        where ${pledge.projectId} = ${project.id} and ${pledge.status} <> 'cancelled'
      ), 0)`,
      pledgeCount: sql<number>`(
        select count(*) from ${pledge}
        where ${pledge.projectId} = ${project.id} and ${pledge.status} <> 'cancelled'
      )`,
    })
    .from(project)
    .where(eq(project.churchId, churchId))
    // Active first, then most recent.
    .orderBy(asc(project.status), desc(project.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    targetAmount: r.targetAmount,
    raised: Number(r.raised),
    pledged: Number(r.pledged),
    pledgeCount: Number(r.pledgeCount),
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
      paid: sql<number>`coalesce((
        select sum(${giving.amount}) from ${giving}
        where ${giving.pledgeId} = ${pledge.id}
      ), 0)`,
    })
    .from(pledge)
    .leftJoin(member, eq(member.id, pledge.memberId))
    .where(and(eq(pledge.projectId, id), eq(pledge.churchId, churchId)))
    .orderBy(asc(pledge.status), desc(pledge.createdAt));

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
    paid: Number(r.paid),
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
