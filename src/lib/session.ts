import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
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
 * Require an authenticated user AND an active church (tenant).
 * Redirects to /login if not signed in, or /onboarding if the user
 * has no active church selected yet.
 */
export async function requireChurch() {
  const data = await getSession();
  if (!data?.user) redirect("/login");

  const activeChurchId = data.session.activeOrganizationId;
  if (!activeChurchId) redirect("/onboarding");

  const [activeChurch] = await db
    .select()
    .from(church)
    .where(eq(church.id, activeChurchId))
    .limit(1);

  if (!activeChurch) redirect("/onboarding");
  if (activeChurch.status === "suspended") redirect("/suspended");

  return { user: data.user, session: data.session, church: activeChurch };
}

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
 * Require a platform superadmin. Redirects non-admins away.
 */
export async function requireSuperAdmin() {
  const data = await getSession();
  if (!data?.user) redirect("/login");
  const ok = await getIsSuperAdmin();
  if (!ok) redirect("/dashboard");
  return data.user;
}
