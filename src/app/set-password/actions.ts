"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireUser, getIsSuperAdmin, getMustChangePassword } from "@/lib/session";
import { setUserPassword } from "@/lib/admin-users";
import { DEMO_ACCOUNT_LOCKED, isSharedDemoUser } from "@/lib/demo-account";

export type ActionResult = { ok: false; error: string };

/**
 * The FORCED change after a support reset, and nothing else.
 *
 * It asks for no current password, because the person was just given a
 * temporary one. That is only safe while the change is actually forced:
 * otherwise anyone at an unlocked church PC could open /set-password and keep
 * the account for good, walking round the current-password check that
 * Profile → Change password exists to make.
 */
export async function setNewPassword(
  password: string,
  confirm: string,
): Promise<ActionResult> {
  const { user: u } = await requireUser();
  if (!(await getMustChangePassword()))
    return {
      ok: false,
      error: "Your password doesn't need changing here. Use Profile → Change password, which asks for your current one.",
    };
  if (await isSharedDemoUser(u.id)) return { ok: false, error: DEMO_ACCOUNT_LOCKED };
  if ((password || "").length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  if (password !== confirm)
    return { ok: false, error: "Passwords don't match." };

  const ok = await setUserPassword(u.id, password);
  if (!ok)
    return { ok: false, error: "Your account has no password to change." };

  await db
    .update(user)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(user.id, u.id));

  const isAdmin = await getIsSuperAdmin();
  redirect(isAdmin ? "/superadmin" : "/dashboard");
}
