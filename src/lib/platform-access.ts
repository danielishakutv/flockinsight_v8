import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformRole, user } from "@/db/schema";
import { getSession } from "@/lib/session";
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
