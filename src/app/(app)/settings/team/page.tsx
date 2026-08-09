import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { staff, user, invitation, role, member } from "@/db/schema";
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

  // Members not yet linked to a login — they can be invited as staff without
  // creating a duplicate person. Members with no email are included: the invite
  // captures one and saves it to their profile, rather than silently hiding
  // them from this list with no explanation.
  const invitableRows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
    })
    .from(member)
    .where(and(eq(member.churchId, church.id), isNull(member.userId)))
    .orderBy(asc(member.firstName))
    .limit(500);

  const invitableMembers = invitableRows.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
    email: m.email?.trim() ? m.email : null,
  }));

  return (
    <TeamManager
      members={members}
      invites={invites}
      roles={assignableRoles}
      currentUserId={me.id}
      invitableMembers={invitableMembers}
    />
  );
}
