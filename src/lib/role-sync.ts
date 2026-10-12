import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { invitation, role, staff, staffInvite } from "@/db/schema";
import { betterAuthRoleFor } from "@/lib/staff-access";

/**
 * Keeping `staff.role` (Better Auth's org role) in step with the church role.
 *
 * Two role concepts live on one staff row (see lib/staff-access.ts). The church
 * role decides what the app lets someone do; `staff.role` is what the
 * organization plugin checks before it lets them invite or remove anyone, and
 * it is also what lib/staff-permissions.ts falls back to when there is no
 * church role at all ("admin" with no role = a legacy full-access admin).
 *
 * Every path that changed a role's permissions, or took a role away, used to
 * leave `staff.role` behind:
 *
 * - deleting a role the FK set `role_id` null and left "admin", so everybody
 *   on a "Secretary" role with team.manage was promoted to EVERYTHING — while
 *   the audit line said "dropped to the basics";
 * - clearing someone's role did the same;
 * - editing a role to remove team.manage left them org-plugin admins, still
 *   able to invite and remove people by calling the plugin directly;
 * - editing a role to ADD team.manage left them "member", so the Team page let
 *   them in and the plugin refused their invites ("You are not allowed to
 *   invite users to this organization").
 *
 * These functions are the only writers of that copy for a role's holders.
 * The owner row is never touched: ownership is not a church role.
 *
 * The same copy also sits on every PENDING invitation raised for a role
 * (`invitation.role`, linked through `staff_invite.role_id`), and the person
 * arrives with it when they accept. So the invitations move with the holders:
 * deleting a "Secretary" role with a secretary's invite still outstanding
 * otherwise let her accept into "admin" with no role — the same full-access
 * fallback, one step later.
 */

export type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Set the org role on this role's still-pending invitations.
 *
 * Two statements rather than a correlated subquery: drizzle drops the table
 * qualifier in a join-less query (AGENTS.md), and this is not worth the risk.
 */
async function setPendingInviteRole(
  tx: DbOrTx,
  churchId: string,
  roleId: string,
  orgRole: "admin" | "member",
): Promise<number> {
  const links = await tx
    .select({ id: staffInvite.invitationId })
    .from(staffInvite)
    .where(eq(staffInvite.roleId, roleId));
  if (links.length === 0) return 0;
  const rows = await tx
    .update(invitation)
    .set({ role: orgRole })
    .where(
      and(
        inArray(
          invitation.id,
          links.map((l) => l.id),
        ),
        eq(invitation.organizationId, churchId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning({ id: invitation.id });
  return rows.length;
}

/** Re-derive `staff.role` for everyone on a role from its permissions. */
export async function syncRoleHolders(
  tx: DbOrTx,
  churchId: string,
  roleId: string,
  permissions: string[],
): Promise<number> {
  // Somebody invited onto this role arrives with what it grants today, not
  // what it granted on the day the invitation was sent.
  await setPendingInviteRole(tx, churchId, roleId, betterAuthRoleFor(permissions));
  const rows = await tx
    .update(staff)
    .set({ role: betterAuthRoleFor(permissions) })
    .where(
      and(
        eq(staff.roleId, roleId),
        eq(staff.organizationId, churchId),
        ne(staff.role, "owner"),
      ),
    )
    .returning({ id: staff.id });
  return rows.length;
}

/**
 * Take everyone off a role, down to the basics.
 *
 * Run BEFORE the role row is deleted, in the same transaction: once the FK has
 * nulled `role_id` the rows can no longer be told apart from a legacy admin.
 * That goes for the pending invitations too (`staff_invite.role_id` is also
 * on delete set null), which drop to "member" here for the same reason.
 */
export async function detachRoleHolders(
  tx: DbOrTx,
  churchId: string,
  roleId: string,
): Promise<number> {
  await setPendingInviteRole(tx, churchId, roleId, "member");
  const rows = await tx
    .update(staff)
    .set({ roleId: null, role: "member" })
    .where(
      and(
        eq(staff.roleId, roleId),
        eq(staff.organizationId, churchId),
        ne(staff.role, "owner"),
      ),
    )
    .returning({ id: staff.id });
  return rows.length;
}

/**
 * Delete a church role, its holders and pending invitations dropping to the
 * basics. Refuses the system role. Returns whether a row was deleted.
 *
 * The role row is locked FIRST (AGENTS.md: one transaction is not isolation).
 * Under READ COMMITTED, an assignRole that put somebody on this role and
 * committed after the detach statement but before the DELETE was invisible to
 * the detach — and the FK's on-delete-set-null then left them "admin" with no
 * role, which is everything. Every write that points a staff row or an
 * invitation at this role takes a KEY SHARE lock on it for the foreign key,
 * which FOR UPDATE conflicts with: an in-flight assignment makes this wait and
 * is then seen by the detach, and a later one fails its FK check because the
 * role has gone.
 */
export async function deleteChurchRole(
  churchId: string,
  roleId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: role.id, isSystem: role.isSystem })
      .from(role)
      .where(and(eq(role.id, roleId), eq(role.churchId, churchId)))
      .for("update");
    if (!locked || locked.isSystem) return false;

    await detachRoleHolders(tx, churchId, roleId);
    const gone = await tx
      .delete(role)
      .where(
        and(
          eq(role.id, roleId),
          eq(role.churchId, churchId),
          eq(role.isSystem, false),
        ),
      )
      .returning({ id: role.id });
    return gone.length === 1;
  });
}
