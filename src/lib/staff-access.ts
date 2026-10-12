/**
 * Which Better Auth org role a church role needs.
 *
 * There are two role concepts in this app: church roles (Pastor, Usher,
 * Finance — carrying real permissions) and Better Auth's org role
 * (owner/admin/member), which is what the organization plugin checks before
 * letting someone invite or remove staff.
 *
 * A church role granting "Manage team" therefore has to carry `admin` too, or
 * the permission silently does nothing. Deriving it here means the two can
 * never drift apart — the invite UI only ever asks for the church role.
 *
 * Pure by design: no imports, so it is unit-testable and safe on the client.
 */

export const TEAM_MANAGE_PERMISSION = "team.manage";

export function betterAuthRoleFor(permissions: string[]): "admin" | "member" {
  return permissions.includes(TEAM_MANAGE_PERMISSION) ? "admin" : "member";
}

/**
 * What `staff.role` becomes when somebody's church role is cleared.
 *
 * - Someone who HAD a church role drops to "member": their "admin" (if any)
 *   came from that role, and keeping it would hand them the legacy
 *   full-access fallback — clearing a role must never widen access.
 * - Someone who never had one keeps what they have: that is a genuine legacy
 *   admin (invited before church roles existed), and demoting them on a no-op
 *   would be a silent loss of access.
 * - The owner is never changed here.
 */
export function orgRoleAfterClearingRole(
  previousRoleId: string | null,
  currentOrgRole: string,
): string {
  if (currentOrgRole === "owner") return "owner";
  return previousRoleId ? "member" : currentOrgRole;
}
