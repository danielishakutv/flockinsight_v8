import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, user, invitation } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { TeamManager } from "@/components/settings/team-manager";

export const metadata = { title: "Team · Settings" };

export default async function TeamSettingsPage() {
  const { church, user: me } = await requireChurch();

  const members = await db
    .select({
      memberId: staff.id,
      role: staff.role,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(eq(staff.organizationId, church.id));

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

  const myRole =
    members.find((m) => m.userId === me.id)?.role ?? "member";

  return (
    <TeamManager
      members={members}
      invites={invites}
      currentUserId={me.id}
      currentRole={myRole}
    />
  );
}
