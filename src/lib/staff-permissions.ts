import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { role, staff } from "@/db/schema";
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions-catalog";

/**
 * What one person may do in one church, resolved from the database alone.
 *
 * Split out of `getAccess()` (lib/permissions.ts) so that code which does not
 * run inside a page render — the Better Auth hooks in lib/auth.ts, which guard
 * the organization plugin's own endpoints — can ask exactly the same question
 * and get exactly the same answer. Two resolvers would drift; one cannot.
 *
 * No `server-only`, no session, no request: the caller says who and where.
 */

export type StaffAccess = {
  isOwner: boolean;
  perms: Set<PermissionKey>;
  staffRole: string | null;
};

export const NO_ACCESS: StaffAccess = {
  isOwner: false,
  perms: new Set(),
  staffRole: null,
};

/** The staff row and its church role, as read from the database. */
export type StaffRowForAccess = {
  /** Better Auth's org role on the staff row: "owner" | "admin" | "member". */
  role: string;
  roleId: string | null;
};
export type RoleRowForAccess = {
  permissions: string[] | null;
  isSystem: boolean;
};

/**
 * The policy, pure so it can be tested without a database.
 *
 * `roleRow` is the church role the staff row points at, or null when it points
 * at nothing (never assigned, or the role was deleted and the FK set it null).
 */
export function resolveStaffAccess(
  s: StaffRowForAccess | null,
  roleRow: RoleRowForAccess | null,
): StaffAccess {
  if (!s) return NO_ACCESS;

  if (s.role === "owner") {
    return { isOwner: true, perms: new Set(ALL_PERMISSIONS), staffRole: "owner" };
  }

  if (s.roleId && roleRow) {
    /*
     * The locked system role means "everything", and it has to mean
     * everything TODAY.
     *
     * A role's permissions are a text[] frozen when the role was created.
     * That is right for a role a church wrote itself — we must never widen
     * access behind their back. But the system role is created by us,
     * described as "Full access to everything. Cannot be changed." and
     * cannot be edited, so a stored list is simply a stale copy of
     * ALL_PERMISSIONS. Churches that signed up before a module existed had
     * people on this role who could not see it, which read as the module
     * being missing rather than hidden.
     */
    if (roleRow.isSystem) {
      return { isOwner: false, perms: new Set(ALL_PERMISSIONS), staffRole: s.role };
    }
    /*
     * A church role is the whole answer. The Better Auth org role on the same
     * row ("admin" when the role carries team.manage) is a copy kept for the
     * organization plugin and must never add anything to it — a stale "admin"
     * left behind by an edited role grants nothing here.
     */
    return {
      isOwner: false,
      perms: new Set(roleRow.permissions ?? []),
      staffRole: s.role,
    };
  }

  /*
   * A role id that resolves to nothing in this church (another church's role,
   * or a row mid-deletion) is not "no role": it is a role we cannot read, and
   * the safe reading of that is the basics, never the legacy admin fallback.
   */
  if (s.roleId) {
    return {
      isOwner: false,
      perms: new Set(MEMBER_DEFAULT_PERMISSIONS),
      staffRole: s.role,
    };
  }

  /*
   * No church role. Legacy admins (people invited as "admin" before church
   * roles existed, or by a plain email invite) keep full access; everyone
   * else gets the basics.
   *
   * This fallback is only safe because nothing ELSE leaves a row as
   * admin-with-no-role: deleting a role and clearing someone's role both write
   * role = "member" in the same statement (settings/roles/actions.ts), and
   * deleting a role also drops its pending invitations to "member"
   * (lib/role-sync.ts). Before that, deleting a "Secretary" role promoted
   * every secretary to everything. Rows escalated that way before the fix are
   * found by scripts/repair-deleted-role-admins.ts.
   */
  if (s.role === "admin") {
    return { isOwner: false, perms: new Set(ALL_PERMISSIONS), staffRole: "admin" };
  }
  return {
    isOwner: false,
    perms: new Set(MEMBER_DEFAULT_PERMISSIONS),
    staffRole: s.role,
  };
}

/**
 * Load and resolve. Only a genuine seat counts: the `temp` row a superadmin's
 * impersonation creates is NOT membership. Acting-as is honoured separately,
 * from the act-as cookie, by `getAccess()`; a temp row that outlives it (an
 * admin offboarded mid-impersonation) must grant nothing.
 */
export async function loadStaffAccess(
  userId: string,
  churchId: string,
): Promise<StaffAccess> {
  const [s] = await db
    .select({ role: staff.role, roleId: staff.roleId })
    .from(staff)
    .where(
      and(
        eq(staff.organizationId, churchId),
        eq(staff.userId, userId),
        eq(staff.temp, false),
      ),
    )
    .limit(1);
  if (!s) return NO_ACCESS;

  let r: RoleRowForAccess | null = null;
  if (s.roleId) {
    const [row] = await db
      .select({ permissions: role.permissions, isSystem: role.isSystem })
      .from(role)
      .where(and(eq(role.id, s.roleId), eq(role.churchId, churchId)))
      .limit(1);
    r = row ?? null;
  }
  return resolveStaffAccess(s, r);
}

/** Owner always; otherwise the permission itself. */
export function accessHas(a: StaffAccess, perm: PermissionKey): boolean {
  return a.isOwner || a.perms.has(perm);
}
