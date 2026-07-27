"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, pledge, project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const optDate = z.preprocess(
  emptyToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").nullable(),
);
const optAmount = z.preprocess(
  (v) =>
    v === "" || v == null
      ? null
      : typeof v === "string"
        ? Number(v.replace(/,/g, ""))
        : v,
  z.number().positive("Amount must be greater than 0").max(1_000_000_000_000).nullable(),
);

const NO_PERM = { ok: false as const, error: "You don't have permission to manage giving." };

/* -------------------------------- Projects -------------------------------- */

const projectSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Add a project name").max(160),
  description: optText(4000),
  targetAmount: optAmount,
  status: z.enum(["active", "completed", "archived"]).default("active"),
  startDate: optDate,
  endDate: optDate,
});

export type ProjectInput = z.input<typeof projectSchema>;

export async function saveProject(input: ProjectInput): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("giving.manage"))) return NO_PERM;
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const fields = {
    name: d.name,
    description: d.description,
    targetAmount: d.targetAmount,
    status: d.status,
    startDate: d.startDate,
    endDate: d.endDate,
  };

  if (d.id) {
    const [row] = await db
      .update(project)
      .set(fields)
      .where(and(eq(project.id, d.id), eq(project.churchId, church.id)))
      .returning({ id: project.id });
    if (!row) return { ok: false, error: "Project not found." };
    revalidatePath("/giving/projects");
    revalidatePath(`/giving/projects/${row.id}`);
    return { ok: true, id: row.id };
  }

  const [row] = await db
    .insert(project)
    .values({ churchId: church.id, ...fields, createdBy: user.id })
    .returning({ id: project.id });
  revalidatePath("/giving/projects");
  return { ok: true, id: row.id };
}

/** Delete a project. Pledges are removed; recorded gifts are kept (unlinked). */
export async function deleteProject(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };
  const { church } = await requireChurch();
  if (!(await can("giving.manage"))) return NO_PERM;
  const [row] = await db
    .delete(project)
    .where(and(eq(project.id, id), eq(project.churchId, church.id)))
    .returning({ id: project.id });
  if (!row) return { ok: false, error: "Project not found." };
  revalidatePath("/giving/projects");
  revalidatePath("/giving");
  return { ok: true, id: row.id };
}

/* --------------------------------- Pledges -------------------------------- */

const pledgeSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  giverName: optText(160),
  amount: z.preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    z.number({ message: "Enter an amount" }).positive("Amount must be greater than 0").max(1_000_000_000_000),
  ),
  cadence: z
    .enum(["one_time", "weekly", "monthly", "quarterly", "yearly", "custom"])
    .default("one_time"),
  cadenceLabel: optText(40),
  installmentAmount: optAmount,
  startDate: optDate,
  note: optText(500),
});

export type PledgeInput = z.input<typeof pledgeSchema>;

export async function savePledge(input: PledgeInput): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("giving.manage"))) return NO_PERM;
  const parsed = pledgeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  // Project must belong to this church.
  const [pr] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, d.projectId), eq(project.churchId, church.id)))
    .limit(1);
  if (!pr) return { ok: false, error: "That project doesn't exist." };

  // A pledge needs a giver: a member of this church, or a typed name.
  let giverName = d.giverName;
  if (d.memberId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, d.memberId), eq(member.churchId, church.id)))
      .limit(1);
    if (!m) return { ok: false, error: "That member isn't in your congregation." };
    giverName = null; // name comes from the member record
  } else if (!giverName) {
    return { ok: false, error: "Pick a member or type a giver name." };
  }

  const fields = {
    memberId: d.memberId,
    giverName,
    amount: d.amount,
    cadence: d.cadence,
    cadenceLabel: d.cadence === "custom" ? d.cadenceLabel : null,
    installmentAmount: d.installmentAmount,
    startDate: d.startDate,
    note: d.note,
  };

  if (d.id) {
    const [row] = await db
      .update(pledge)
      .set(fields)
      .where(and(eq(pledge.id, d.id), eq(pledge.churchId, church.id)))
      .returning({ id: pledge.id });
    if (!row) return { ok: false, error: "Pledge not found." };
    revalidatePath(`/giving/projects/${d.projectId}`);
    return { ok: true, id: row.id };
  }

  const [row] = await db
    .insert(pledge)
    .values({
      churchId: church.id,
      projectId: d.projectId,
      ...fields,
      createdBy: user.id,
    })
    .returning({ id: pledge.id });
  revalidatePath(`/giving/projects/${d.projectId}`);
  return { ok: true, id: row.id };
}

export async function setPledgeStatus(
  id: string,
  status: "active" | "completed" | "cancelled",
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };
  const { church } = await requireChurch();
  if (!(await can("giving.manage"))) return NO_PERM;
  const [row] = await db
    .update(pledge)
    .set({ status })
    .where(and(eq(pledge.id, id), eq(pledge.churchId, church.id)))
    .returning({ id: pledge.id, projectId: pledge.projectId });
  if (!row) return { ok: false, error: "Pledge not found." };
  revalidatePath(`/giving/projects/${row.projectId}`);
  return { ok: true, id: row.id };
}

/** Delete a pledge. Any payments already recorded against it are kept. */
export async function deletePledge(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };
  const { church } = await requireChurch();
  if (!(await can("giving.manage"))) return NO_PERM;
  const [row] = await db
    .delete(pledge)
    .where(and(eq(pledge.id, id), eq(pledge.churchId, church.id)))
    .returning({ id: pledge.id, projectId: pledge.projectId });
  if (!row) return { ok: false, error: "Pledge not found." };
  revalidatePath(`/giving/projects/${row.projectId}`);
  return { ok: true, id: row.id };
}
