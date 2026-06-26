"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireUser, getIsSuperAdmin } from "@/lib/session";
import { setUserPassword } from "@/lib/admin-users";

export type ActionResult = { ok: false; error: string };

export async function setNewPassword(
  password: string,
  confirm: string,
): Promise<ActionResult> {
  const { user: u } = await requireUser();
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
