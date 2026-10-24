"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";

import {
  adminResetPassword,
  afterAccountEmailChanged,
  expireUserSessions,
  setUserPassword,
} from "@/lib/admin-users";
import { auth } from "@/lib/auth";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";
import { recordAudit } from "@/lib/audit";

import { requirePlatform, type PlatformAccess } from "@/lib/platform-access";
import { adminAccountRefusal } from "@/lib/platform-grant-policy";
import { addAdmin, removeAdmin } from "@/app/superadmin/roles/actions";

export type ResetResult =
  | { ok: true; tempPassword: string; emailed: boolean }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };
/** `notices` is set only when the email moved: how many of the two were sent. */
export type UpdateUserResult =
  | { ok: true; notices?: { sent: number; of: number } }
  | { ok: false; error: string };

const ROLES = ["owner", "admin", "member"] as const;

/**
 * Only a full-access admin may change another admin's account.
 *
 * `platform.users.manage` is flagged as escalating for ordinary accounts —
 * reset an owner's password and you are them — and that is accepted. Pointed at
 * an UNRESTRICTED admin it is a different thing: a scoped support agent could
 * set a full admin's password (or change their email and send the reset link
 * there), sign in as them, and hold every platform permission their own role
 * was written to withhold. Your own account is exempt; another admin's is not.
 */
async function guardAdminTarget(
  access: PlatformAccess,
  userId: string,
): Promise<{ ok: false; error: string } | null> {
  if (userId === access.id || access.unrestricted) return null;
  const [target] = await db
    .select({ isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // The rule itself is pure and tested in lib/platform-grant-policy.ts.
  const error = adminAccountRefusal(
    access,
    target ? { id: userId, isSuperAdmin: target.isSuperAdmin } : null,
  );
  return error ? { ok: false, error } : null;
}

/** Update a user's name and email. */
export async function updateUser(
  userId: string,
  input: { name: string; email: string },
): Promise<UpdateUserResult> {
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  const refused = await guardAdminTarget(admin, userId);
  if (refused) return refused;
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (name.length < 1 || name.length > 120)
    return { ok: false, error: "Enter a valid name." };
  if (!z.string().email().max(160).safeParse(email).success)
    return { ok: false, error: "Enter a valid email." };

  const [clash] = await db
    .select({ id: user.id })
    .from(user)
    // Case-blind: "Ada@x.com" and "ada@x.com" are one mailbox, and one login.
    .where(and(sql`lower(${user.email}) = ${email}`, ne(user.id, userId)))
    .limit(1);
  if (clash) return { ok: false, error: "That email is already in use." };

  const [before] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!before) return { ok: false, error: "User not found." };

  await db
    .update(user)
    .set({ name, email, updatedAt: new Date() })
    .where(eq(user.id, userId));

  /*
   * An email change decides where the next password-reset link goes, so it is
   * an account takeover step and must leave a trace. A name change alone is
   * recorded too, but quietly; it is the email that matters.
   */
  if (before.email !== email || before.name !== name) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "update_user",
      summary:
        before.email !== email
          ? `Changed the account email from ${before.email} to ${email}`
          : `Renamed an account from "${before.name}" to "${name}"`,
      targetType: "user",
      targetId: userId,
    });
  }
  // Both addresses told, and a Partner's withdrawal inbox proved again.
  // Compared case-blind: re-saving "Ada@x.com" as "ada@x.com" is not a move.
  let notices: { sent: number; of: number } | undefined;
  if (before.email.toLowerCase() !== email) {
    const told = await afterAccountEmailChanged({ userId, name, from: before.email, to: email });
    notices = { sent: told.noticesSent, of: told.noticesTried };
  }
  revalidatePath("/superadmin/users");
  revalidatePath(`/superadmin/users/${userId}`);
  return { ok: true, notices };
}

/** Permanently delete a user account. Can't delete your own. */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if (userId === admin.id)
    return { ok: false, error: "You can't delete your own account." };
  const refusedDelete = await guardAdminTarget(admin, userId);
  if (refusedDelete) return refusedDelete;
  const [u] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  await db.delete(user).where(eq(user.id, userId));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "delete_user",
    summary: `Deleted user ${u?.email ?? userId}`,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/** Add a user to a church (or change their role there). */
export async function assignUserToChurch(
  userId: string,
  churchId: string,
  role: (typeof ROLES)[number],
): Promise<ActionResult> {
  await requirePlatform("platform.users.manage");
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
  await requirePlatform("platform.users.manage");
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
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  const refused = await guardAdminTarget(admin, userId);
  if (refused) return refused;

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

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "reset_password",
    summary: `Reset password for ${u.email} (temporary password)`,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/superadmin/users");
  return { ok: true, tempPassword: res.tempPassword, emailed };
}

/** Admin sets a specific password for a user (optionally force a change). */
export async function setUserPasswordAction(
  userId: string,
  password: string,
  forceChange: boolean,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if ((password || "").length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  const refused = await guardAdminTarget(admin, userId);
  if (refused) return refused;

  const ok = await setUserPassword(userId, password);
  if (!ok)
    return { ok: false, error: "This account signs in another way (no password to set)." };

  await db
    .update(user)
    .set({ mustChangePassword: forceChange, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId));

  // Somebody else changing your password is exactly the kind of thing you want
  // to hear about — even (especially) if you didn't ask for it. The new
  // password itself is never emailed; they were told it another way.
  const [target] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (target?.email) {
    await sendEmail({
      to: target.email,
      subject: "Your FlockInsight password was changed",
      html: emailLayout(
        "Your password was changed",
        `<p>Hi ${target.name || "there"},</p>` +
          `<p>FlockInsight support set a new password on your account at your request.` +
          `${forceChange ? " You'll be asked to choose your own password the next time you log in." : ""}</p>` +
          `<p>If you didn't ask for this, contact us immediately — someone else may have access to your account.</p>`,
        { label: "Log in", url: `${siteUrl()}/login` },
      ),
      text: "FlockInsight support set a new password on your account. If you didn't ask for this, contact us immediately.",
    }).catch(() => false);
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_password",
    summary: `Set a new password${forceChange ? " (must change on next login)" : ""}`,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath(`/superadmin/users/${userId}`);
  return { ok: true };
}

export type SignOutResult = { ok: true; ended: number } | { ok: false; error: string };

/**
 * Sign an account out of every device it is signed in on.
 *
 * What to do after a password is changed on an account somebody else may be
 * in: a new password stops the next sign-in, not the session already open.
 * Not for your own account — it would end the session you are using.
 */
export async function signOutEverywhere(userId: string): Promise<SignOutResult> {
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  if (userId === admin.id)
    return { ok: false, error: "That would sign you out too — use Sign out on each of your own devices instead." };
  const refused = await guardAdminTarget(admin, userId);
  if (refused) return refused;

  const ended = await expireUserSessions(userId);
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.sessions.revoke",
    summary: `Signed an account out of every device (${ended} session${ended === 1 ? "" : "s"})`,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath(`/superadmin/users/${userId}`);
  return { ok: true, ended };
}

/** Email the user a self-service password reset link (Better Auth flow). */
export async function sendResetLink(userId: string): Promise<ActionResult> {
  const admin = await requirePlatform("platform.users.manage");
  const refused = await guardAdminTarget(admin, userId);
  if (refused) return refused;
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

/**
 * Grant or revoke platform superadmin. Can't remove your own.
 *
 * Delegates to the role-aware actions rather than flipping the flag itself.
 * The direct write needed only `platform.users.manage` and left
 * `platformRoleId` null — which platformAccess() reads as UNRESTRICTED — so a
 * scoped support agent could make a second account of theirs a full admin
 * with backups, roles, finance and church deletion. addAdmin needs both
 * roles.manage and users.manage, and only a full admin may grant full access;
 * removeAdmin also clears the role and ends any impersonation left open.
 */
export async function setSuperAdmin(
  userId: string,
  makeAdmin: boolean,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.users.manage");
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  // Said here rather than left to addAdmin's requirePlatform, which would
  // redirect a scoped admin away mid-click instead of telling them why.
  if (!admin.perms.has("platform.roles.manage"))
    return {
      ok: false,
      error: "Changing admin access needs the roles permission too — use Admin roles.",
    };
  return makeAdmin
    ? addAdmin({ userId, roleId: null })
    : removeAdmin(userId);
}
