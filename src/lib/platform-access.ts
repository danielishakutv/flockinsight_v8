import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformRole, staff, user } from "@/db/schema";
import { getSession } from "@/lib/session";
import { repointSessionsToOwnChurch } from "@/lib/session-pointer";
import {
  ALL_PLATFORM_PERMISSIONS,
  landingPage,
  type PlatformPermission,
} from "@/lib/platform-permissions";

/**
 * What the signed-in admin may do on the platform side.
 *
 * Two shapes of admin:
 *
 * - Unrestricted: `isSuperAdmin` with no role. This is what every admin was
 *   before roles existed, and leaving it as the default is what stops anyone
 *   being locked out the moment this ships.
 * - Scoped: `isSuperAdmin` with a role, limited to that role's permissions.
 *
 * Resolved from the role at read time rather than copied onto the user, so
 * editing a role takes effect immediately instead of on next login — the same
 * reason the church-side roles work that way.
 */

export type PlatformAccess = {
  /** The admin's user id. Named `id` to match what the session returns. */
  id: string;
  // user.name is NOT NULL; only roleName below can be absent.
  name: string;
  /** No role attached: may do everything. */
  unrestricted: boolean;
  roleId: string | null;
  roleName: string | null;
  perms: Set<PlatformPermission>;
};

export const platformAccess = cache(async (): Promise<PlatformAccess | null> => {
  const data = await getSession();
  if (!data?.user) return null;

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.platformRoleId,
      roleName: platformRole.name,
      permissions: platformRole.permissions,
    })
    .from(user)
    .leftJoin(platformRole, eq(platformRole.id, user.platformRoleId))
    .where(eq(user.id, data.user.id))
    .limit(1);

  if (!row?.isSuperAdmin) return null;

  const unrestricted = row.roleId === null;
  return {
    id: row.id,
    name: row.name,
    unrestricted,
    roleId: row.roleId,
    roleName: row.roleName,
    perms: new Set(
      unrestricted ? ALL_PLATFORM_PERMISSIONS : (row.permissions ?? []),
    ),
  };
});

/** Does the signed-in admin hold this permission? */
export async function canPlatform(
  perm: PlatformPermission,
): Promise<boolean> {
  const access = await platformAccess();
  return access ? access.perms.has(perm) : false;
}

/**
 * Gate a page or action on one permission.
 *
 * Sends someone who is not an admin at all back to their own dashboard, and
 * someone who is an admin but lacks this permission to the first page they
 * CAN open — bouncing them to a dashboard they are not allowed to see would
 * be a redirect loop.
 */
export async function requirePlatform(perm: PlatformPermission) {
  const access = await platformAccess();
  if (!access) redirect("/dashboard");
  if (!access.perms.has(perm)) redirect(landingPage(access.perms));
  return access;
}

/**
 * End everything platform access left behind on an account, at the moment the
 * access is taken away.
 *
 * "Act as church" leaves two things on the admin: a `temp` owner seat in the
 * church (so the org plugin can operate) and `activeOrganizationId` on every
 * one of their sessions. Only `exitImpersonation` undid them, and it demands
 * the very permission a revoked admin no longer has. So an admin offboarded
 * mid-impersonation kept the session pointing at that church, with an owner
 * row to resolve — full owner powers over somebody else's members and giving,
 * for as long as they kept the session alive.
 *
 * requireChurch() and getAccess() now refuse a temp seat on their own; this
 * removes the residue as well, so nothing that reads the session pointer
 * directly keeps answering either.
 *
 * Only the temp seats, and only sessions aimed at a church they do not
 * genuinely belong to — and those are re-aimed at a church they DO belong to
 * rather than nulled (lib/session-pointer.ts). Impersonating points every one
 * of an admin's sessions at the church, so an operator who is also a pastor
 * would otherwise land on "Create your church" the moment access ended.
 *
 * Called when platform access ends, and when an admin's role stops carrying
 * the permission to act as a church: exitImpersonation needs that permission,
 * so without this the seat and the pointer could never be cleared.
 */
export async function revokePlatformResidue(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(staff)
      .where(and(eq(staff.userId, userId), eq(staff.temp, true)));
    await repointSessionsToOwnChurch(tx, userId);
  });
}
