import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { staff, user, invitation, role, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import {
  ALL_PERMISSIONS,
  ensureDefaultRoles,
  getAccess,
  requireCan,
} from "@/lib/permissions";
import { permissionsBeyond } from "@/lib/staff-permissions";
import { TeamManager } from "@/components/settings/team-manager";
import { ranksForUsers } from "@/lib/certification";
import type { CertRank } from "@/lib/certification-shared";

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

  // A plain "admin" invite grants everything, so it is only offered to
  // somebody who holds everything. lib/org-plugin-guard.ts enforces it.
  const canInviteAdmin =
    permissionsBeyond(await getAccess(), ALL_PERMISSIONS).length === 0;

  // The FlockInsight course rank beside each name: only the rank crosses to
  // the client, for people who are staff of this church.
  const rankMap = await ranksForUsers(members.map((m) => m.userId));
  const ranks: Record<string, CertRank> = Object.fromEntries(
    [...rankMap].map(([userId, r]) => [userId, r.rank]),
  );

  return (
    <TeamManager
      members={members}
      invites={invites}
      roles={assignableRoles}
      currentUserId={me.id}
      invitableMembers={invitableMembers}
      canInviteAdmin={canInviteAdmin}
      ranks={ranks}
    />
  );
}
