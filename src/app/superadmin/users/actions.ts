"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { adminResetPassword } from "@/lib/admin-users";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

export type ResetResult =
  | { ok: true; tempPassword: string; emailed: boolean }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

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
