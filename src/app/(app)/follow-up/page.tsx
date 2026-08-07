import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { followUpInteraction, member, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FollowUpList, type FollowUpPerson } from "@/components/follow-up/follow-up-list";

export const metadata = { title: "Follow-up" };

export default async function FollowUpPage() {
  const { church } = await requireChurch();
  await requireCan("followup.view");
  const canManage = await can("followup.manage");

  const [people, counts, candidates] = await Promise.all([
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
        memberStatus: member.status,
        followUpStatus: member.followUpStatus,
        lastContactedAt: member.lastContactedAt,
        assignedToId: member.assignedToId,
        assignedName: user.name,
      })
      .from(member)
      .leftJoin(user, eq(user.id, member.assignedToId))
      .where(
        and(
          eq(member.churchId, church.id),
          or(
            inArray(member.status, ["visitor", "new_convert"]),
            eq(member.inFollowUp, true),
          ),
        ),
      )
      .orderBy(sql`${member.lastContactedAt} asc nulls first`),
    db
      .select({ memberId: followUpInteraction.memberId, c: count() })
      .from(followUpInteraction)
      .where(eq(followUpInteraction.churchId, church.id))
      .groupBy(followUpInteraction.memberId),
    // Active members not already tracked — candidates to add manually.
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(
        and(
          eq(member.churchId, church.id),
          eq(member.status, "active"),
          eq(member.inFollowUp, false),
        ),
      )
      .orderBy(member.firstName, member.lastName),
  ]);

  const countMap = new Map(counts.map((c) => [c.memberId, c.c]));

  const rows: FollowUpPerson[] = people.map((p) => ({
    id: p.id,
    name: [p.firstName, p.lastName].filter(Boolean).join(" "),
    phone: p.phone,
    memberStatus: p.memberStatus,
    followUpStatus: p.followUpStatus,
    assignedName: p.assignedName,
    lastContactedAt: p.lastContactedAt
      ? p.lastContactedAt.toISOString()
      : null,
    interactions: countMap.get(p.id) ?? 0,
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Follow-up"
        description={`${rows.length} ${rows.length === 1 ? "person" : "people"} to follow up`}
      />
      <FollowUpList
        canManage={canManage}
        people={rows}
        candidates={candidates.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        }))}
      />
    </PageContainer>
  );
}
