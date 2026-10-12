import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "./auth";
import { readActAsCookie } from "./impersonation";
import { db } from "@/db";
import { church, partner, platformRole, staff, user } from "@/db/schema";

/**
 * Returns the current Better Auth session (user + session) or null.
 * Cached per-request so multiple calls in one render hit the DB once.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Require an authenticated user. Redirects to /login if absent.
 *
 * `returnTo` is where the login page sends them afterwards. Pages outside the
 * proxy's matcher (the Partner pages) must pass it: without one, somebody who
 * followed a link to `/partner/join` signed in and landed on their church
 * dashboard with no way back to what they had come to do.
 */
export async function requireUser(returnTo?: string) {
  const data = await getSession();
  if (!data?.user) {
    redirect(
      returnTo ? `/login?redirect=${encodeURIComponent(returnTo)}` : "/login",
    );
  }
  return data;
}

/**
 * Is this person in the Partner programme?
 *
 * Asked where "no church" used to mean only "has not finished signing up":
 * a Partner has an account and, deliberately, no church — sending them to
 * "Set up your church" on every sign-in made the one account type that is
 * meant to live outside a church look like a broken church sign-up.
 */
export const getIsPartner = cache(async (): Promise<boolean> => {
  const data = await getSession();
  if (!data?.user) return false;
  const [row] = await db
    .select({ id: partner.id })
    .from(partner)
    .where(eq(partner.userId, data.user.id))
    .limit(1);
  return !!row;
});

/** Where somebody with no church goes: their Partner dashboard, or set one up. */
async function noChurchPath(): Promise<string> {
  return (await getIsPartner()) ? "/partner" : "/onboarding";
}

/**
 * May this admin act as a church RIGHT NOW?
 *
 * Not just "is a superadmin": acting as a church is `platform.churches.manage`,
 * the same permission `impersonateChurch` demanded on the way in. Checking only
 * the flag meant an admin whose role lost that permission mid-impersonation
 * kept owner powers until the 8-hour cookie ran out — a downgrade that did not
 * take effect. Read here directly (not via lib/platform-access, which imports
 * this file) so a role edit applies on the very next request.
 */
const ACT_AS_PERMISSION = "platform.churches.manage";
const canActAsChurch = cache(async (): Promise<boolean> => {
  const data = await getSession();
  if (!data?.user) return false;
  const [row] = await db
    .select({
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.platformRoleId,
      permissions: platformRole.permissions,
    })
    .from(user)
    .leftJoin(platformRole, eq(platformRole.id, user.platformRoleId))
    .where(eq(user.id, data.user.id))
    .limit(1);
  if (!row?.isSuperAdmin) return false;
  // No role = unrestricted, as in platformAccess().
  if (row.roleId === null) return true;
  return (row.permissions ?? []).includes(ACT_AS_PERMISSION);
});

/**
 * The church a superadmin is currently "acting as" (operating on behalf of),
 * or null. Honoured ONLY for superadmins who still hold the permission to act
 * as a church, and only when the target church still exists — so a forged
 * cookie from a normal user, or a stale one from a demoted admin, is worthless.
 */
export const getActAsChurchId = cache(async (): Promise<string | null> => {
  const churchId = await readActAsCookie();
  if (!churchId) return null;
  if (!(await canActAsChurch())) return null;
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

  /*
   * No church selected is not the same as no church. A pointer can be null
   * because a seat elsewhere was taken away (lib/session-pointer.ts re-aims
   * them, but a session from before that, or one cleared by hand, may still
   * be empty) — and /onboarding would then offer somebody who belongs to a
   * church the chance to create a duplicate with a fresh trial.
   */
  if (!activeChurchId) {
    const mine = await getMyChurches();
    redirect(mine.length > 0 ? "/select-church" : await noChurchPath());
  }

  const [activeChurch] = await db
    .select()
    .from(church)
    .where(eq(church.id, activeChurchId))
    .limit(1);

  // The church it points at is gone: the same choice as no pointer at all.
  if (!activeChurch) {
    const mine = await getMyChurches();
    redirect(mine.length > 0 ? "/select-church" : await noChurchPath());
  }

  /*
   * The active church must be one of theirs.
   *
   * It is a plain column with no foreign key, set at login or by a switch, and
   * it can outlive the membership that justified it — somebody removed from a
   * church they were switched into would otherwise keep rendering its shell
   * with every permission check failing, which looks like the app breaking
   * rather than like access ending.
   *
   * This used to redirect only when they belonged somewhere ELSE, to cover an
   * owner "in the seconds between creating a church and the staff row
   * landing". No such window exists any more — signup inserts the staff row in
   * the same transaction, before it sets the active church, and the org
   * plugin's create writes the owner row before set-active can be called — and
   * the narrow rule let a volunteer removed from their only church keep
   * opening its exports until their session expired. So: a genuine (non-temp)
   * seat in THIS church, or out. Superadmins acting-as are exempt via actAsId.
   */
  if (!actAsId) {
    const mine = await getMyChurches();
    if (!mine.some((c) => c.id === activeChurch.id)) {
      redirect(mine.length > 0 ? "/select-church" : await noChurchPath());
    }
  }
  // Don't bounce an acting-as superadmin out of a suspended church — they may
  // be entering precisely to investigate or fix it.
  if (activeChurch.status === "suspended" && !actAsId) redirect("/suspended");

  /*
   * The demonstration church's door, enforced HERE rather than in a layout.
   *
   * It began as a branch in the app layout, which meant it only ran while a
   * page was being rendered — so anybody who knew the shared demo password
   * could call a server action directly and never meet it. Every page, every
   * server action and every API route in the app passes through this function,
   * so this is the one place that cannot be stepped around.
   *
   * A superadmin is exempt: they are the one person who needs to get in to fix
   * it. An acting-as superadmin likewise.
   */
  if (activeChurch.isDemo && !actAsId) {
    const { getDemoState } = await import("./demo");
    const [state, admin] = await Promise.all([
      getDemoState(activeChurch.id, true),
      getIsSuperAdmin(),
    ]);
    if (!admin && (state.kind === "ask" || state.kind === "expired")) {
      redirect("/try");
    }
  }

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
