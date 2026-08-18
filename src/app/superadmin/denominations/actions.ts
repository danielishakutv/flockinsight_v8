"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, denomination } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  assignChurches,
  getDenomination,
  mergeDenominations,
  unassignChurches,
} from "@/lib/denominations";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };
export type CountResult = { ok: true; count: number } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  name: z.string().trim().min(2, "Give the denomination a name").max(120),
  abbreviation: z.preprocess(emptyToNull, z.string().trim().max(20).nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable()),
});

export async function createDenomination(
  input: z.input<typeof schema>,
): Promise<CreateResult> {
  const admin = await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [existing] = await db
    .select({ id: denomination.id })
    .from(denomination)
    .where(eq(denomination.name, d.name))
    .limit(1);
  if (existing) return { ok: false, error: "That denomination already exists." };

  const [row] = await db
    .insert(denomination)
    .values({ ...d, createdBy: admin.id })
    .returning({ id: denomination.id });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "denomination_created",
    summary: `Created denomination "${d.name}"`,
    targetType: "denomination",
    targetId: row.id,
  });
  revalidatePath("/superadmin/denominations");
  return { ok: true, id: row.id };
}

const updateSchema = schema.extend({ id: z.string().uuid() });

export async function updateDenomination(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { id, ...d } = parsed.data;

  await db.update(denomination).set(d).where(eq(denomination.id, id));
  // Keep the churches' own label in step with the rename.
  await db
    .update(church)
    .set({ denomination: d.name })
    .where(eq(church.denominationId, id));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "denomination_updated",
    summary: `Renamed a denomination to "${d.name}"`,
    targetType: "denomination",
    targetId: id,
  });
  revalidatePath("/superadmin/denominations");
  revalidatePath(`/superadmin/denominations/${id}`);
  return { ok: true };
}

const assignSchema = z.object({
  id: z.string().uuid(),
  churchIds: z.array(z.string()).min(1, "Pick at least one church"),
});

export async function addChurches(
  input: z.input<typeof assignSchema>,
): Promise<CountResult> {
  const admin = await requireSuperAdmin();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const moved = await assignChurches(parsed.data.id, parsed.data.churchIds);
  const target = await getDenomination(parsed.data.id);
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "denomination_churches_added",
    summary: `Added ${moved} church(es) to "${target?.name ?? "a denomination"}"`,
    targetType: "denomination",
    targetId: parsed.data.id,
  });
  revalidatePath("/superadmin/denominations");
  revalidatePath(`/superadmin/denominations/${parsed.data.id}`);
  return { ok: true, count: moved };
}

export async function removeChurches(
  input: z.input<typeof assignSchema>,
): Promise<CountResult> {
  await requireSuperAdmin();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const moved = await unassignChurches(parsed.data.churchIds);
  revalidatePath("/superadmin/denominations");
  revalidatePath(`/superadmin/denominations/${parsed.data.id}`);
  return { ok: true, count: moved };
}

/** Set (or clear) one church's denomination — used from the church page. */
const oneSchema = z.object({
  churchId: z.string(),
  denominationId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

export async function setChurchDenomination(
  input: z.input<typeof oneSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = oneSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { churchId, denominationId } = parsed.data;

  if (denominationId) {
    const moved = await assignChurches(denominationId, [churchId]);
    if (moved === 0) return { ok: false, error: "That denomination no longer exists." };
  } else {
    await unassignChurches([churchId]);
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "church_denomination_set",
    summary: denominationId
      ? "Assigned a church to a denomination"
      : "Removed a church from its denomination",
    targetType: "church",
    targetId: churchId,
  });
  revalidatePath(`/superadmin/churches/${churchId}`);
  revalidatePath("/superadmin/denominations");
  return { ok: true };
}

const mergeSchema = z.object({
  fromId: z.string().uuid(),
  intoId: z.string().uuid(),
});

/** Fold a duplicate into the real one. Nothing is deleted — it's archived. */
export async function mergeDenomination(
  input: z.input<typeof mergeSchema>,
): Promise<CountResult> {
  const admin = await requireSuperAdmin();
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { fromId, intoId } = parsed.data;
  if (fromId === intoId)
    return { ok: false, error: "Pick a different denomination to merge into." };

  const [from, into] = await Promise.all([
    getDenomination(fromId),
    getDenomination(intoId),
  ]);
  if (!from || !into) return { ok: false, error: "Denomination not found." };

  const moved = await mergeDenominations(fromId, intoId);
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "denomination_merged",
    summary: `Merged "${from.name}" into "${into.name}" (${moved} churches moved)`,
    targetType: "denomination",
    targetId: intoId,
  });
  revalidatePath("/superadmin/denominations");
  return { ok: true, count: moved };
}

/** Bring an archived denomination back into use. */
export async function restoreDenomination(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db
    .update(denomination)
    .set({ archived: false })
    .where(eq(denomination.id, id));
  revalidatePath("/superadmin/denominations");
  return { ok: true };
}

/** Archive one that's no longer used, without losing the name. */
export async function archiveDenomination(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db
    .update(denomination)
    .set({ archived: true })
    .where(eq(denomination.id, id));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "denomination_archived",
    summary: "Archived a denomination",
    targetType: "denomination",
    targetId: id,
  });
  revalidatePath("/superadmin/denominations");
  return { ok: true };
}
