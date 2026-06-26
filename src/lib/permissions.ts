import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { role, staff } from "@/db/schema";
import { getSession, getActAsChurchId } from "@/lib/session";
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions-catalog";

// Re-export the catalog so server callers can keep importing from here.
export * from "@/lib/permissions-catalog";

/* ============================================================
 * Access resolution
 * ========================================================== */

export type Access = {
  isOwner: boolean;
  perms: Set<PermissionKey>;
  staffRole: string | null;
};

const EMPTY: Access = { isOwner: false, perms: new Set(), staffRole: null };

/**
 * The signed-in user's effective access within their active church.
 * Cached per-request. Owner (church creator) always has everything.
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

  const [s] = await db
    .select({ role: staff.role, roleId: staff.roleId })
    .from(staff)
    .where(and(eq(staff.organizationId, churchId), eq(staff.userId, data.user.id)))
    .limit(1);
  if (!s) return EMPTY;

  if (s.role === "owner") {
    return { isOwner: true, perms: new Set(ALL_PERMISSIONS), staffRole: "owner" };
  }

  if (s.roleId) {
    const [r] = await db
      .select({ permissions: role.permissions })
      .from(role)
      .where(and(eq(role.id, s.roleId), eq(role.churchId, churchId)))
      .limit(1);
    if (r) return { isOwner: false, perms: new Set(r.permissions), staffRole: s.role };
  }

  // No custom role assigned yet — keep legacy admins fully enabled, and give
  // everyone else the baseline "Member" permissions.
  if (s.role === "admin") {
    return { isOwner: false, perms: new Set(ALL_PERMISSIONS), staffRole: "admin" };
  }
  return {
    isOwner: false,
    perms: new Set(MEMBER_DEFAULT_PERMISSIONS),
    staffRole: s.role,
  };
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
