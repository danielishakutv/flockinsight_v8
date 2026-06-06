import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "@/db";
import { church } from "@/db/schema";

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

  return { user: data.user, session: data.session, church: activeChurch };
}
