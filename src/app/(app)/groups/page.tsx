import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { GroupsList, type GroupRow } from "@/components/groups/groups-list";

export const metadata = { title: "Groups & Ministries" };

export default async function GroupsPage() {
  const { church } = await requireChurch();
  await requireCan("groups.view");
  const canManage = await can("groups.manage");

  const [rows, leaderRows, members] = await Promise.all([
    db
      .select({
        id: group.id,
        name: group.name,
        type: group.type,
        description: group.description,
        meetingDay: group.meetingDay,
        meetingTime: group.meetingTime,
        isActive: group.isActive,
        memberCount: count(groupMembership.id),
      })
      .from(group)
      .leftJoin(groupMembership, eq(groupMembership.groupId, group.id))
      .where(eq(group.churchId, church.id))
      .groupBy(group.id)
      .orderBy(asc(group.name)),
    // Leaders/heads per group (a group may have several).
    db
      .select({
        groupId: groupMembership.groupId,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(groupMembership)
      .innerJoin(group, eq(group.id, groupMembership.groupId))
      .innerJoin(member, eq(member.id, groupMembership.memberId))
      .where(
        and(eq(group.churchId, church.id), eq(groupMembership.isLeader, true)),
      )
      .orderBy(asc(member.firstName), asc(member.lastName)),
    // Congregation list to choose an initial leader when creating a group.
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(eq(member.churchId, church.id))
      .orderBy(asc(member.firstName), asc(member.lastName)),
  ]);

  const leadersByGroup = new Map<string, string[]>();
  for (const l of leaderRows) {
    const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
    const list = leadersByGroup.get(l.groupId) ?? [];
    list.push(name);
    leadersByGroup.set(l.groupId, list);
  }

  const candidates = members.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
  }));

  const groups: GroupRow[] = rows.map((r) => ({
    ...r,
    memberCount: Number(r.memberCount),
    leaders: leadersByGroup.get(r.id) ?? [],
  }));

  const ministries = groups.filter((g) => g.type === "ministry").length;

  return (
    <PageContainer>
      <PageHeader
        title="Groups & Ministries"
        description={`${groups.length} total · ${ministries} ${ministries === 1 ? "ministry" : "ministries"}`}
      />
      <GroupsList
        groups={groups}
        candidates={candidates}
        canManage={canManage}
      />
    </PageContainer>
  );
}
