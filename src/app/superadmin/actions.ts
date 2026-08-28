"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment, session, staff } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { writeActAsCookie, clearActAsCookie } from "@/lib/impersonation";
import { activatePlan } from "@/lib/billing";
import {
  emailChurchBeforeDeletion,
  notifyChurchOfAdminAction,
} from "@/lib/admin-notify";
import { planName } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Enter a church's workspace as a superadmin ("log in as church"). Sets the
 * act-as cookie and lands on the church's dashboard. The superadmin keeps
 * their own identity; they simply gain owner-level access to this church until
 * they exit. Returns an error result only on failure (otherwise it redirects).
 */
export async function impersonateChurch(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [target] = await db
    .select({ id: church.id })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  await writeActAsCookie(target.id);
  // Point the actual session at this church too, so org-plugin operations
  // (e.g. team invites) target the impersonated church — never a default one.
  await db
    .update(session)
    .set({ activeOrganizationId: target.id })
    .where(eq(session.userId, admin.id));

  // Clear any stale temp membership from a previous session, then grant a
  // temporary owner membership in THIS church so org-plugin operations work.
  await db
    .delete(staff)
    .where(and(eq(staff.userId, admin.id), eq(staff.temp, true)));
  const [existing] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.organizationId, target.id), eq(staff.userId, admin.id)))
    .limit(1);
  if (!existing) {
    await db.insert(staff).values({
      id: crypto.randomUUID(),
      organizationId: target.id,
      userId: admin.id,
      role: "owner",
      temp: true,
    });
  }
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "impersonate",
    summary: `Logged in as a church to assist`,
    targetType: "church",
    targetId: target.id,
  });
  redirect("/dashboard");
}

/** Stop acting as a church and return to the admin panel. */
export async function exitImpersonation(): Promise<void> {
  const admin = await requireSuperAdmin();
  await clearActAsCookie();
  await db
    .update(session)
    .set({ activeOrganizationId: null })
    .where(eq(session.userId, admin.id));
  // Remove the temporary owner membership granted during impersonation.
  await db
    .delete(staff)
    .where(and(eq(staff.userId, admin.id), eq(staff.temp, true)));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "exit_impersonation",
    summary: "Stopped acting as a church",
  });
  redirect("/superadmin");
}

const PLANS = ["starter", "growth", "pro", "enterprise"] as const;

/** Admin onboarding/billing: set plan + discount, optionally extend renewal. */
export async function adminSetBilling(input: {
  churchId: string;
  plan: (typeof PLANS)[number];
  discountPct: number;
  months: number;
  note?: string;
}): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const { churchId, plan } = input;
  if (!PLANS.includes(plan)) return { ok: false, error: "Invalid plan" };
  if (!z.string().min(1).safeParse(churchId).success)
    return { ok: false, error: "Invalid id" };

  const disc = Math.min(100, Math.max(0, Math.round(input.discountPct || 0)));
  const months = Math.min(36, Math.max(0, Math.round(input.months || 0)));

  await db
    .update(church)
    .set({ planDiscountPct: disc })
    .where(eq(church.id, churchId));
  if (months > 0) await activatePlan(churchId, plan, months);
  else await db.update(church).set({ plan }).where(eq(church.id, churchId));

  await db.insert(payment).values({
    churchId,
    plan,
    amount: 0,
    currency: "NGN",
    gateway: "admin",
    reference: `ADMIN-${churchId.slice(0, 8)}-${Date.now()}`,
    status: "success",
    periodMonths: months || 1,
    note:
      (input.note && input.note.slice(0, 200)) ||
      `Admin set ${plan}${disc ? ` (${disc}% off)` : ""}${months ? ` · ${months}mo` : ""}`,
    createdBy: admin.id,
    paidAt: new Date(),
  });

  await notifyChurchOfAdminAction({
    churchId,
    title: "Your plan was updated",
    subject: `Your FlockInsight plan is now ${planName(plan)}`,
    body: `The FlockInsight team has set your church to the ${planName(plan)} plan${months ? `, paid up for ${months} month${months === 1 ? "" : "s"}` : ""}. The features on that plan are available immediately.`,
    details: [
      { label: "Plan", value: planName(plan) },
      ...(disc ? [{ label: "Discount", value: `${disc}% off` }] : []),
      ...(months
        ? [{ label: "Period", value: `${months} month${months === 1 ? "" : "s"}` }]
        : []),
    ],
    note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
    linkUrl: "/settings/billing",
    ctaLabel: "View billing",
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_billing",
    summary: `Set plan to ${planName(plan)}${disc ? ` (${disc}% off)` : ""}${months ? ` · ${months}mo` : ""}`,
    targetType: "church",
    targetId: churchId,
  });
  revalidatePath(`/superadmin/churches/${churchId}`);
  revalidatePath("/superadmin/churches");
  return { ok: true };
}

export async function setChurchPlan(
  id: string,
  plan: (typeof PLANS)[number],
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  if (!PLANS.includes(plan)) return { ok: false, error: "Invalid plan" };

  await db.update(church).set({ plan }).where(eq(church.id, id));
  await notifyChurchOfAdminAction({
    churchId: id,
    title: "Your plan was updated",
    subject: `Your FlockInsight plan is now ${planName(plan)}`,
    body: `The FlockInsight team has moved your church onto the ${planName(plan)} plan.`,
    details: [{ label: "Plan", value: planName(plan) }],
    linkUrl: "/settings/billing",
    ctaLabel: "View billing",
  });
  revalidatePath("/superadmin/churches");
  revalidatePath(`/superadmin/churches/${id}`);
  return { ok: true };
}

/** Feature / unfeature a church in the public directory. */
export async function setChurchFeatured(
  id: string,
  featured: boolean,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db.update(church).set({ featured }).where(eq(church.id, id));
  revalidatePath("/superadmin/churches");
  revalidatePath("/churches");
  return { ok: true };
}

export async function setChurchStatus(
  id: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  if (status !== "active" && status !== "suspended")
    return { ok: false, error: "Invalid status" };

  await db.update(church).set({ status }).where(eq(church.id, id));
  // A suspended church can't read an in-app notice — which is exactly why the
  // email matters. `notifyChurchOfAdminAction` sends both; the in-app copy is
  // simply waiting for them when access is restored.
  await notifyChurchOfAdminAction({
    churchId: id,
    title: status === "suspended" ? "Your church has been suspended" : "Your church is active again",
    subject:
      status === "suspended"
        ? "Your FlockInsight account has been suspended"
        : "Your FlockInsight account has been reactivated",
    body:
      status === "suspended"
        ? "Your church account has been suspended, so nobody on your team can sign in for now. Your data is safe and untouched — get in touch and we'll work out how to restore access."
        : "Your church account has been reactivated. Your whole team can sign in again and everything is exactly where you left it. Welcome back!",
    linkUrl: status === "suspended" ? null : "/dashboard",
    ctaLabel: "Open your dashboard",
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: status === "suspended" ? "suspend_church" : "reactivate_church",
    summary: `${status === "suspended" ? "Suspended" : "Reactivated"} a church`,
    targetType: "church",
    targetId: id,
  });
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
  const admin = await requireSuperAdmin();
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

  // Ordered deliberately: the cascade removes every staff row, so the only
  // moment we can still find someone to tell is before the delete runs.
  await emailChurchBeforeDeletion({ churchId: id, churchName: target.name });

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

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "delete_church",
    summary: `Permanently deleted church "${target.name}"`,
    targetType: "church",
    targetId: id,
  });
  revalidatePath("/superadmin/churches");
  revalidatePath("/superadmin");
  return { ok: true };
}
