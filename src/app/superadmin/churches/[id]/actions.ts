"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { resetChurch, restoreChurchAsNew, type ChurchBackup } from "@/lib/church-data";
import { recordAudit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Reset a church: clears its operational data (members, attendance, giving,
 * groups, follow-up, forms, devotionals, subscribers, events, media) but keeps
 * the account, team, roles, services, giving categories and settings.
 * Requires typing the exact church name to confirm. A backup should be taken
 * first (the UI forces this); the platform DB is also backed up daily.
 */
export async function resetChurchAction(
  id: string,
  confirmName: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid church." };

  const [c] = await db
    .select({ id: church.id, name: church.name })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  if (confirmName.trim() !== c.name.trim())
    return { ok: false, error: "The name you typed doesn't match. Nothing was changed." };

  await resetChurch(id);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "reset_church",
    summary: `Reset church data for "${c.name}" (kept account, team & settings)`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/**
 * Restore a backup as a BRAND-NEW church (never touches existing churches).
 */
export async function restoreChurchAction(
  backupJson: string,
): Promise<{ ok: true; churchId: string; name: string } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin();

  let backup: ChurchBackup;
  try {
    backup = JSON.parse(backupJson) as ChurchBackup;
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }

  const res = await restoreChurchAsNew(backup);
  if (!res.ok) return res;

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "restore_church",
    summary: `Restored a backup into a new church "${res.name}"`,
    targetType: "church",
    targetId: res.churchId,
  });

  revalidatePath("/superadmin/churches");
  return res;
}

/** Comp a church: waive payment so it never needs to pay to use the app. */
export async function setPaymentWaived(
  id: string,
  waived: boolean,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const [c] = await db
    .select({ name: church.name })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  await db.update(church).set({ paymentWaived: waived }).where(eq(church.id, id));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "waive_payment",
    summary: `${waived ? "Waived" : "Un-waived"} payment for "${c.name}"`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/** Extend a church's free trial by N weeks (from the later of now / current end). */
export async function extendTrial(id: string, weeks: number): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const w = Math.max(1, Math.min(52, Math.round(weeks)));

  const [c] = await db
    .select({ name: church.name, trialEndsAt: church.trialEndsAt })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const now = new Date();
  const base =
    c.trialEndsAt && new Date(c.trialEndsAt) > now ? new Date(c.trialEndsAt) : now;
  const newEnd = new Date(base);
  newEnd.setDate(newEnd.getDate() + w * 7);

  await db
    .update(church)
    .set({ trialEndsAt: newEnd, trialReminderStage: 0 })
    .where(eq(church.id, id));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "extend_trial",
    summary: `Extended trial for "${c.name}" by ${w} week(s) → ${newEnd.toDateString()}`,
    targetType: "church",
    targetId: id,
  });

  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/* ============================================================
 * Church networks
 * ========================================================== */

const parentSchema = z.object({
  churchId: z.string().min(1),
  parentChurchId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().nullable(),
  ),
});

/**
 * Point a church at its headquarters (or detach it), from the platform side.
 * Churches normally arrange this between themselves under Branches; this is
 * the operator's override for fixing a mistake or setting one up on request.
 */
export async function setChurchParent(
  input: z.input<typeof parentSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = parentSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { churchId, parentChurchId } = parsed.data;

  if (parentChurchId === churchId)
    return { ok: false, error: "A church cannot be its own headquarters." };

  if (parentChurchId) {
    // Networks stay one level deep, so reporting has a single, obvious shape.
    const [parent] = await db
      .select({ id: church.id, parentChurchId: church.parentChurchId })
      .from(church)
      .where(eq(church.id, parentChurchId))
      .limit(1);
    if (!parent) return { ok: false, error: "That headquarters no longer exists." };
    if (parent.parentChurchId)
      return {
        ok: false,
        error: "That church is itself a branch — pick its headquarters instead.",
      };

    const [ownBranch] = await db
      .select({ id: church.id })
      .from(church)
      .where(eq(church.parentChurchId, churchId))
      .limit(1);
    if (ownBranch)
      return {
        ok: false,
        error: "This church already has branches, so it cannot become one.",
      };
  }

  await db
    .update(church)
    .set({ parentChurchId, ...(parentChurchId ? {} : { zone: null }) })
    .where(eq(church.id, churchId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: parentChurchId ? "church_linked_to_hq" : "church_unlinked_from_hq",
    summary: parentChurchId
      ? "Linked a church to a headquarters"
      : "Detached a church from its headquarters",
    targetType: "church",
    targetId: churchId,
  });

  revalidatePath(`/superadmin/churches/${churchId}`);
  revalidatePath("/superadmin/churches");
  return { ok: true };
}
