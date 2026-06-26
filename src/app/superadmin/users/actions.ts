"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { adminResetPassword, setUserPassword } from "@/lib/admin-users";
import { auth } from "@/lib/auth";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

export type ResetResult =
  | { ok: true; tempPassword: string; emailed: boolean }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const ROLES = ["owner", "admin", "member"] as const;

/** Update a user's name and email. */
export async function updateUser(
  userId: string,
  input: { name: string; email: string },
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (name.length < 1 || name.length > 120)
    return { ok: false, error: "Enter a valid name." };
  if (!z.string().email().max(160).safeParse(email).success)
    return { ok: false, error: "Enter a valid email." };

  const [clash] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, email), ne(user.id, userId)))
    .limit(1);
  if (clash) return { ok: false, error: "That email is already in use." };

  await db
    .update(user)
    .set({ name, email, updatedAt: new Date() })
    .where(eq(user.id, userId));
  revalidatePath("/superadmin/users");
  revalidatePath(`/superadmin/users/${userId}`);
  return { ok: true };
}

/** Permanently delete a user account. Can't delete your own. */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if (userId === admin.id)
    return { ok: false, error: "You can't delete your own account." };
  await db.delete(user).where(eq(user.id, userId));
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/** Add a user to a church (or change their role there). */
export async function assignUserToChurch(
  userId: string,
  churchId: string,
  role: (typeof ROLES)[number],
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!ROLES.includes(role)) return { ok: false, error: "Invalid role" };
  if (
    !z.string().min(1).safeParse(userId).success ||
    !z.string().min(1).safeParse(churchId).success
  )
    return { ok: false, error: "Invalid id" };

  const [c] = await db
    .select({ id: church.id })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const [existing] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.userId, userId)))
    .limit(1);

  if (existing) {
    await db.update(staff).set({ role }).where(eq(staff.id, existing.id));
  } else {
    await db.insert(staff).values({
      id: crypto.randomUUID(),
      organizationId: churchId,
      userId,
      role,
    });
  }
  revalidatePath(`/superadmin/users/${userId}`);
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/** Remove a user from a church. */
export async function removeUserFromChurch(
  userId: string,
  churchId: string,
): Promise<ActionResult> {
  await requireSuperAdmin();
  await db
    .delete(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.userId, userId)));
  revalidatePath(`/superadmin/users/${userId}`);
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/** Reset a user's password to a temp one, email it, and force a change. */
export async function resetUserPasswordAction(
  userId: string,
): Promise<ResetResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };

  const [u] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u) return { ok: false, error: "User not found." };

  const res = await adminResetPassword(userId);
  if (!res.ok) return res;

  let emailed = false;
  try {
    emailed = await sendEmail({
      to: u.email,
      subject: "Your FlockInsight password was reset",
      html: emailLayout(
        "Password reset",
        `<p>Hi ${u.name || "there"},</p>` +
          `<p>FlockInsight support reset your password. Use this temporary password to log in:</p>` +
          `<p style="font-size:20px;font-weight:800;letter-spacing:1px">${res.tempPassword}</p>` +
          `<p>For your security, you'll be asked to set a new password right after you log in.</p>`,
        { label: "Log in", url: `${siteUrl()}/login` },
      ),
      text: `Your FlockInsight temporary password is: ${res.tempPassword}\nLog in at ${siteUrl()}/login and set a new password.`,
    });
  } catch {
    emailed = false;
  }

  revalidatePath("/superadmin/users");
  return { ok: true, tempPassword: res.tempPassword, emailed };
}

/** Admin sets a specific password for a user (optionally force a change). */
export async function setUserPasswordAction(
  userId: string,
  password: string,
  forceChange: boolean,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if ((password || "").length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };

  const ok = await setUserPassword(userId, password);
  if (!ok)
    return { ok: false, error: "This account signs in another way (no password to set)." };

  await db
    .update(user)
    .set({ mustChangePassword: forceChange, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId));
  revalidatePath(`/superadmin/users/${userId}`);
  return { ok: true };
}

/** Email the user a self-service password reset link (Better Auth flow). */
export async function sendResetLink(userId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const [u] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u) return { ok: false, error: "User not found." };
  try {
    await auth.api.requestPasswordReset({
      body: { email: u.email, redirectTo: "/reset-password" },
    });
  } catch (e) {
    console.error("sendResetLink failed", e);
    return { ok: false, error: "Could not send the reset email." };
  }
  return { ok: true };
}

/** Grant or revoke platform superadmin. Can't remove your own. */
export async function setSuperAdmin(
  userId: string,
  makeAdmin: boolean,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if (!makeAdmin && userId === admin.id)
    return { ok: false, error: "You can't remove your own superadmin access." };

  await db
    .update(user)
    .set({ isSuperAdmin: makeAdmin, updatedAt: new Date() })
    .where(eq(user.id, userId));
  revalidatePath("/superadmin/users");
  return { ok: true };
}
