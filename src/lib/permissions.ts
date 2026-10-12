import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { role } from "@/db/schema";
import { getSession, getActAsChurchId } from "@/lib/session";
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions-catalog";
import {
  NO_ACCESS,
  loadStaffAccess,
  type StaffAccess,
} from "@/lib/staff-permissions";

// Re-export the catalog so server callers can keep importing from here.
export * from "@/lib/permissions-catalog";

/* ============================================================
 * Access resolution
 * ========================================================== */

export type Access = StaffAccess;

const EMPTY: Access = NO_ACCESS;

/**
 * The signed-in user's effective access within their active church.
 * Cached per-request. Owner (church creator) always has everything.
 *
 * The policy itself lives in lib/staff-permissions.ts, shared with the Better
 * Auth hooks that guard the organization plugin's endpoints.
 */
export const getAccess = cache(async (): Promise<Access> => {
  const data = await getSession();
  if (!data?.user) return EMPTY;

  // A superadmin acting as a church operates it with full owner powers so they
  // can actually resolve issues. (getActAsChurchId already verified superadmin.)
  const actAsId = await getActAsChurchId();
  if (actAsId) {
    return { isOwner: true, perms: new Set(ALL_PERMISSIONS), staffRole: "owner" };
  }

  const churchId = data.session.activeOrganizationId;
  if (!churchId) return EMPTY;

  // temp rows are excluded there: impersonation is the act-as branch above,
  // never a staff row that outlived it.
  return loadStaffAccess(data.user.id, churchId);
});

/** Does the current user hold a permission? Owner always does. */
export async function can(perm: PermissionKey): Promise<boolean> {
  const a = await getAccess();
  return a.isOwner || a.perms.has(perm);
}

/** True if the user holds ANY of the given permissions. */
export async function canAny(perms: PermissionKey[]): Promise<boolean> {
  const a = await getAccess();
  return a.isOwner || perms.some((p) => a.perms.has(p));
}

/** Page guard: redirect to /dashboard (always reachable) if lacking access. */
export async function requireCan(perm: PermissionKey): Promise<void> {
  if (!(await can(perm))) redirect("/dashboard");
}

export async function requireCanAny(perms: PermissionKey[]): Promise<void> {
  if (!(await canAny(perms))) redirect("/dashboard");
}

/* ============================================================
 * Default role seeding (lazy — runs the first time roles are needed)
 * ========================================================== */

export async function ensureDefaultRoles(churchId: string): Promise<void> {
  const existing = await db
    .select({ id: role.id })
    .from(role)
    .where(eq(role.churchId, churchId))
    .limit(1);
  if (existing.length > 0) return;

  await db
    .insert(role)
    .values([
      {
        churchId,
        name: "Owner",
        description: "Full access to everything. Cannot be changed.",
        permissions: ALL_PERMISSIONS,
        isSystem: true,
      },
      {
        churchId,
        name: "Admin",
        description: "Full access. Edit or remove as you like.",
        permissions: ALL_PERMISSIONS,
        isSystem: false,
      },
      {
        churchId,
        name: "Member",
        description: "View-only access to the basics.",
        permissions: MEMBER_DEFAULT_PERMISSIONS,
        isSystem: false,
      },
    ])
    .onConflictDoNothing();
}
