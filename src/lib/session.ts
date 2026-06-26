import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { readActAsCookie } from "./impersonation";
import { db } from "@/db";
import { church, user } from "@/db/schema";

/**
 * Returns the current Better Auth session (user + session) or null.
 * Cached per-request so multiple calls in one render hit the DB once.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Require an authenticated user. Redirects to /login if absent.
 */
export async function requireUser() {
  const data = await getSession();
  if (!data?.user) redirect("/login");
  return data;
}

/**
 * The church a superadmin is currently "acting as" (operating on behalf of),
 * or null. Honoured ONLY for superadmins, and only when the target church
 * still exists — so a forged cookie from a normal user is worthless.
 */
export const getActAsChurchId = cache(async (): Promise<string | null> => {
  const churchId = await readActAsCookie();
  if (!churchId) return null;
  if (!(await getIsSuperAdmin())) return null;
  const [row] = await db
    .select({ id: church.id })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return row?.id ?? null;
});

/**
 * Require an authenticated user AND an active church (tenant).
 * Redirects to /login if not signed in, or /onboarding if the user
 * has no active church selected yet.
 *
 * Returns `impersonating: true` when a superadmin is acting as this church.
 */
export const requireChurch = cache(async () => {
  const data = await getSession();
  if (!data?.user) redirect("/login");

  // A superadmin "acting as" a church overrides their own active tenant.
  const actAsId = await getActAsChurchId();
  const activeChurchId = actAsId ?? data.session.activeOrganizationId;
  if (!activeChurchId) redirect("/onboarding");

  const [activeChurch] = await db
    .select()
    .from(church)
    .where(eq(church.id, activeChurchId))
    .limit(1);

  if (!activeChurch) redirect("/onboarding");
  // Don't bounce an acting-as superadmin out of a suspended church — they may
  // be entering precisely to investigate or fix it.
  if (activeChurch.status === "suspended" && !actAsId) redirect("/suspended");

  return {
    user: data.user,
    session: data.session,
    church: activeChurch,
    impersonating: !!actAsId,
  };
});

/**
 * True if the signed-in user is a platform superadmin (FlockInsight operator).
 * Reads the flag from the DB (it isn't part of the Better Auth session object).
 */
export const getIsSuperAdmin = cache(async () => {
  const data = await getSession();
  if (!data?.user) return false;
  const [row] = await db
    .select({ isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, data.user.id))
    .limit(1);
  return !!row?.isSuperAdmin;
});

/**
 * True if the signed-in user must set a new password (after a support reset).
 * Used to gate the app and force a password change.
 */
export const getMustChangePassword = cache(async (): Promise<boolean> => {
  const data = await getSession();
  if (!data?.user) return false;
  const [row] = await db
    .select({ flag: user.mustChangePassword })
    .from(user)
    .where(eq(user.id, data.user.id))
    .limit(1);
  return !!row?.flag;
});

/**
 * Require a platform superadmin. Redirects non-admins away.
 */
export async function requireSuperAdmin() {
  const data = await getSession();
  if (!data?.user) redirect("/login");
  const ok = await getIsSuperAdmin();
  if (!ok) redirect("/dashboard");
  return data.user;
}
