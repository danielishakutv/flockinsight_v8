/**
 * Nobody on the platform side hands out, or takes away, more than they hold.
 *
 * Pure, so the rules can be tested without a database. The actions in
 * app/superadmin/roles and app/superadmin/users load the rows and ask here.
 *
 * Two shapes of admin (lib/platform-access.ts): unrestricted (no role — may do
 * anything) and scoped (a role's permissions). Earlier rules only closed the
 * door to "no role", which is full access. A scoped admin with
 * platform.roles.manage could still:
 *
 * - add every permission to any role, including the one they are on, and so
 *   be one click from full powers;
 * - put another admin on a role carrying permissions they themselves lack;
 * - move or remove an admin whose role reaches further than their own.
 *
 * So a scoped admin acts only inside their own reach: they may grant a set of
 * permissions only when they hold every one of them, may change or remove an
 * admin only when that admin's powers are within theirs, and may not edit the
 * role they are on at all. An unrestricted admin is unaffected.
 */

export type PlatformCaller = {
  id: string;
  unrestricted: boolean;
  roleId: string | null;
  perms: ReadonlySet<string>;
};

/** `null` means "no role", which is unrestricted access. */
export type PlatformGrant = readonly string[] | null;

/** Would this grant reach beyond what the caller holds? */
export function exceedsCaller(caller: PlatformCaller, grant: PlatformGrant): boolean {
  if (caller.unrestricted) return false;
  if (grant === null) return true;
  return grant.some((p) => !caller.perms.has(p));
}

/** Giving an admin these permissions (addAdmin, assignRole's new role). */
export function grantRefusal(
  caller: PlatformCaller,
  grant: PlatformGrant,
): string | null {
  if (!exceedsCaller(caller, grant)) return null;
  return grant === null
    ? "Only a full-access admin can grant full access."
    : "That role includes permissions you don't have yourself. Ask a full-access admin to give it.";
}

/**
 * Changing or removing an admin who currently holds `current`
 * (assignRole's existing role, removeAdmin, and account edits).
 */
export function targetRefusal(
  caller: PlatformCaller,
  target: { id: string; isSuperAdmin: boolean; permissions: PlatformGrant },
): string | null {
  if (caller.unrestricted || !target.isSuperAdmin) return null;
  if (target.id === caller.id) return null;
  if (!exceedsCaller(caller, target.permissions)) return null;
  return target.permissions === null
    ? "Only a full-access admin can change another full-access admin."
    : "That admin can do things you can't. Ask a full-access admin to change their access.";
}

/**
 * Account edits in /superadmin/users (name, email, password, delete) on
 * another admin. Stricter than targetRefusal on purpose: an email change
 * decides where the password-reset link goes, so editing ANY other admin's
 * account is an account takeover step and stays with full-access admins.
 */
export function adminAccountRefusal(
  caller: PlatformCaller,
  target: { id: string; isSuperAdmin: boolean } | null,
): string | null {
  if (caller.unrestricted || target?.id === caller.id) return null;
  if (target?.isSuperAdmin)
    return "Only a full-access admin can change another admin's account.";
  return null;
}

/** Creating a role, or editing one (`existing` is its stored permissions). */
export function saveRoleRefusal(
  caller: PlatformCaller,
  edit: { id?: string; permissions: readonly string[]; existing?: readonly string[] },
): string | null {
  if (caller.unrestricted) return null;
  if (edit.id && edit.id === caller.roleId)
    return "You can't edit the role you're on — ask a full-access admin.";
  if (exceedsCaller(caller, edit.permissions))
    return "You can only give a role permissions you have yourself.";
  // Narrowing a role that reaches further than you would change what admins
  // above you can do.
  if (edit.existing && exceedsCaller(caller, edit.existing))
    return "That role can do things you can't. Ask a full-access admin to change it.";
  return null;
}
