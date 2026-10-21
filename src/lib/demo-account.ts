import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";

/**
 * The shared demo login's own account, which no visitor may change.
 *
 * The demo is ONE account whose email and password are printed on the sign-in
 * page (lib/demo.ts). Every prospect signs in as it. So its password, its
 * sign-in email and its name are not one visitor's to change: the first person
 * to change the password locked every later prospect out of the advertised
 * demo until an operator repaired it by hand, and moving the email to their own
 * address handed them the account outright through a password reset.
 *
 * Kept apart from lib/demo.ts, which reads cookies and sends mail, because the
 * Better Auth hooks in lib/auth.ts ask this too and must not import all that.
 * No `server-only` for the same reason as lib/staff-permissions.ts.
 */

export const DEMO_ACCOUNT_LOCKED =
  "This is the shared demo account, so its name, email and password can't be changed: everyone trying FlockInsight signs in with them. Start your own church to have an account of your own.";

/**
 * Better Auth's own endpoints that change the signed-in account. The app's
 * profile actions are guarded separately; these are the same changes made by
 * calling the library directly, which the published password is enough for.
 */
export const DEMO_LOCKED_AUTH_PATHS = [
  "/update-user",
  "/change-password",
  "/change-email",
  "/delete-user",
] as const;

/** Pure: does this Better Auth path change the account itself? */
export function isDemoLockedAuthPath(path: string | undefined | null): boolean {
  return !!path && (DEMO_LOCKED_AUTH_PATHS as readonly string[]).includes(path);
}

/**
 * Pure: is this the shared demo login, from its seats and its platform flag?
 *
 * Only when EVERY genuine seat is in a demo church. A real person who also
 * holds a seat in the demo church (an operator, a partner showing it off) has
 * an account of their own and keeps control of it, and so does any superadmin.
 */
export function isSharedDemoAccount(
  seats: readonly { isDemo: boolean }[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return false;
  return seats.length > 0 && seats.every((s) => s.isDemo);
}

/** Read the facts and decide. Temp rows (impersonation) are not seats. */
export async function isSharedDemoUser(userId: string): Promise<boolean> {
  const [u] = await db
    .select({ isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u) return false;
  const seats = await db
    .select({ isDemo: church.isDemo })
    .from(staff)
    .innerJoin(church, eq(church.id, staff.organizationId))
    .where(and(eq(staff.userId, userId), eq(staff.temp, false)));
  return isSharedDemoAccount(seats, u.isSuperAdmin);
}
