import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "./auth";
import { readActAsCookie } from "./impersonation";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";

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
 * The church this person is operating in, or null.
 *
 * Unlike `requireChurch()` this redirects nowhere and demands nothing — it is
 * for code that works with or without a church, such as writing an audit row
 * for somebody editing their own account.
 */
export const getActiveChurchId = cache(async (): Promise<string | null> => {
  const actAsId = await getActAsChurchId();
  if (actAsId) return actAsId;
  const data = await getSession();
  const id = data?.session?.activeOrganizationId;
  return typeof id === "string" && id ? id : null;
});

/**
 * Does this person hold a genuine seat in this church?
 *
 * "Genuine" excludes the `temp` row a superadmin's impersonation creates —
 * that one exists so the org plugin can operate, and treating it as membership
 * would make every church a superadmin has ever visited look like their own.
 */
async function hasRealMembership(
  userId: string,
  churchId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.userId, userId),
        eq(staff.organizationId, churchId),
        eq(staff.temp, false),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * The churches this person is actually a member of, newest membership last.
 *
 * One query, cached per request: the church switcher, the login chooser and
 * the superadmin exception above all need the same answer.
 */
export const getMyChurches = cache(
  async (): Promise<
    { id: string; name: string; slug: string; logo: string | null; role: string }[]
  > => {
    const data = await getSession();
    if (!data?.user) return [];
    return db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        logo: church.logo,
        role: staff.role,
      })
      .from(staff)
      .innerJoin(church, eq(church.id, staff.organizationId))
      .where(and(eq(staff.userId, data.user.id), eq(staff.temp, false)))
      .orderBy(staff.createdAt);
  },
);

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

  /*
   * Superadmins operate from /superadmin, never a church — with one exception,
   * and it matters: a platform operator who is also a pastor somewhere.
   *
   * The original rule bounced EVERY superadmin to /superadmin, so the operator
   * of this platform could not open their own church's settings without
   * impersonating themselves. The exception is narrow and checked against the
   * database, not inferred: they must hold a real, non-`temp` staff row in the
   * church they are opening. A `temp` row is the one impersonation creates, so
   * including it would re-open the very leak this rule exists to prevent.
   */
  if (!actAsId && (await getIsSuperAdmin())) {
    const ownChurch =
      activeChurchId && (await hasRealMembership(data.user.id, activeChurchId));
    if (!ownChurch) redirect("/superadmin");
  }

  if (!activeChurchId) redirect("/onboarding");

  const [activeChurch] = await db
    .select()
    .from(church)
    .where(eq(church.id, activeChurchId))
    .limit(1);

  if (!activeChurch) redirect("/onboarding");

  /*
   * The active church must be one of theirs.
   *
   * It is a plain column with no foreign key, set at login or by a switch, and
   * it can outlive the membership that justified it — somebody removed from a
   * church they were switched into would otherwise keep rendering its shell
   * with every permission check failing, which looks like the app breaking
   * rather than like access ending.
   *
   * Narrow on purpose: only redirected when they DO belong somewhere else, so
   * there is a real choice to offer. With no memberships at all this changes
   * nothing, because this is also the path a church's own owner takes in the
   * seconds between creating a church and the staff row landing.
   */
  if (!actAsId) {
    const mine = await getMyChurches();
    if (mine.length > 0 && !mine.some((c) => c.id === activeChurch.id)) {
      redirect("/select-church");
    }
  }
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
