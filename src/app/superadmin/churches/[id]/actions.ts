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
