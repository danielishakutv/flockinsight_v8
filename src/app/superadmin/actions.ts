"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, session } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PLANS = ["starter", "growth", "pro", "enterprise"] as const;

export async function setChurchPlan(
  id: string,
  plan: (typeof PLANS)[number],
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  if (!PLANS.includes(plan)) return { ok: false, error: "Invalid plan" };

  await db.update(church).set({ plan }).where(eq(church.id, id));
  revalidatePath("/superadmin/churches");
  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

export async function setChurchStatus(
  id: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  if (status !== "active" && status !== "suspended")
    return { ok: false, error: "Invalid status" };

  await db.update(church).set({ status }).where(eq(church.id, id));
  revalidatePath("/superadmin/churches");
  revalidatePath("/superadmin");
  return { ok: true };
}

/**
 * Permanently delete a church and ALL of its data. This is irreversible:
 * the foreign-key cascades remove its staff memberships, members, services,
 * attendance sessions/records, and pending invitations. User *accounts* are
 * left intact (a user may belong to other churches).
 *
 * `confirmName` must exactly match the church's name — a server-side guard so
 * a stray click can never wipe the wrong church.
 */
export async function deleteChurch(
  id: string,
  confirmName: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [target] = await db
    .select({ id: church.id, name: church.name })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  if (confirmName.trim() !== target.name) {
    return { ok: false, error: "The name you typed doesn't match the church." };
  }

  await db.transaction(async (tx) => {
    // `session.activeOrganizationId` has no FK, so clear any dangling pointers
    // to this church before deleting it (affected users fall back to onboarding).
    await tx
      .update(session)
      .set({ activeOrganizationId: null })
      .where(eq(session.activeOrganizationId, id));
    // Cascades remove staff, members, services, attendance, and invitations.
    await tx.delete(church).where(eq(church.id, id));
  });

  revalidatePath("/superadmin/churches");
  revalidatePath("/superadmin");
  return { ok: true };
}
