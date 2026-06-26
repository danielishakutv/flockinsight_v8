import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, user, invitation, role } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { ensureDefaultRoles, requireCan } from "@/lib/permissions";
import { TeamManager } from "@/components/settings/team-manager";

export const metadata = { title: "Team · Settings" };

export default async function TeamSettingsPage() {
  const { church, user: me } = await requireChurch();
  await requireCan("team.manage");
  await ensureDefaultRoles(church.id);

  const members = await db
    .select({
      memberId: staff.id,
      role: staff.role,
      roleId: staff.roleId,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    // Hide temporary memberships created while a superadmin is acting as us.
    .where(and(eq(staff.organizationId, church.id), eq(staff.temp, false)));

  const invites = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, church.id),
        eq(invitation.status, "pending"),
      ),
    );

  // Assignable roles (everything except the locked Owner role).
  const roles = await db
    .select({ id: role.id, name: role.name, isSystem: role.isSystem })
    .from(role)
    .where(eq(role.churchId, church.id))
    .orderBy(asc(role.name));

  const assignableRoles = roles
    .filter((r) => !r.isSystem)
    .map((r) => ({ id: r.id, name: r.name }));

  return (
    <TeamManager
      members={members}
      invites={invites}
      roles={assignableRoles}
      currentUserId={me.id}
    />
  );
}
