import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { followUpInteraction, member, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FollowUpList, type FollowUpPerson } from "@/components/follow-up/follow-up-list";
import { getT } from "@/lib/i18n/server";
import { PlanGate } from "@/components/app/plan-gate";

export const metadata = { title: "Follow-up" };

export default async function FollowUpPage() {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("followup.view");
  const canManage = await can("followup.manage");

  const [people, counts, candidates, allActive] = await Promise.all([
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
    /*
     * A second, wider list: every active member, for "who invited them" on the
     * first-timer form. Not the same set as the one above, which deliberately
     * excludes anyone already in follow-up — the member who brought a visitor
     * is often being followed up themselves, and leaving them out would make
     * the inviter unnameable.
     */
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(and(eq(member.churchId, church.id), eq(member.status, "active")))
      .orderBy(member.firstName, member.lastName)
      .limit(5000),
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
      <PlanGate feature="followUp" />

      <PageHeader
        title={t("followUp.title")}
        description={t("common.people", { count: rows.length })}
      />
      <FollowUpList
        canManage={canManage}
        people={rows}
        candidates={candidates.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        }))}
        newFaceCandidates={allActive.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        }))}
      />
    </PageContainer>
  );
}
