import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { followUpInteraction, member, staff, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { isSmsConfigured } from "@/lib/sms";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  FollowUpDetail,
  type FollowUpInteractionRow,
} from "@/components/follow-up/follow-up-detail";

export const metadata = { title: "Follow-up" };

export default async function FollowUpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("followup.view");
  const canManage = await can("followup.manage");

  const [m] = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      email: member.email,
      memberStatus: member.status,
      followUpStatus: member.followUpStatus,
      assignedToId: member.assignedToId,
    })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, church.id)))
    .limit(1);
  if (!m) notFound();

  const [interactions, team] = await Promise.all([
    db
      .select({
        id: followUpInteraction.id,
        type: followUpInteraction.type,
        outcome: followUpInteraction.outcome,
        notes: followUpInteraction.notes,
        occurredAt: followUpInteraction.occurredAt,
        byName: user.name,
      })
      .from(followUpInteraction)
      .leftJoin(user, eq(user.id, followUpInteraction.createdBy))
      .where(
        and(
          eq(followUpInteraction.memberId, id),
          eq(followUpInteraction.churchId, church.id),
        ),
      )
      .orderBy(
        desc(followUpInteraction.occurredAt),
        desc(followUpInteraction.createdAt),
      ),
    db
      .select({ userId: user.id, name: user.name })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(eq(staff.organizationId, church.id)),
  ]);

  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");

  return (
    <PageContainer className="max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/follow-up">
          <ArrowLeft className="size-4" />
          Follow-up
        </Link>
      </Button>

      <FollowUpDetail
        member={{
          id: m.id,
          name,
          phone: m.phone,
          email: m.email,
          memberStatus: m.memberStatus,
          followUpStatus: m.followUpStatus,
          assignedToId: m.assignedToId,
        }}
        interactions={interactions as FollowUpInteractionRow[]}
        team={team}
        smsEnabled={isSmsConfigured()}
        canManage={canManage}
      />
    </PageContainer>
  );
}
