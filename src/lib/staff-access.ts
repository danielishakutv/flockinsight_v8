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
