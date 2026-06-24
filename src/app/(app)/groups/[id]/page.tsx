import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  GroupDetail,
  type GroupMemberRow,
} from "@/components/groups/group-detail";

export const metadata = { title: "Group" };

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("groups.view");
  const canManage = await can("groups.manage");

  const [g] = await db
    .select()
    .from(group)
    .where(and(eq(group.id, id), eq(group.churchId, church.id)))
    .limit(1);
  if (!g) notFound();

  // Current members of this group — leaders/heads first.
  const members: GroupMemberRow[] = (
    await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
        email: member.email,
        status: member.status,
        isLeader: groupMembership.isLeader,
        role: groupMembership.role,
      })
      .from(groupMembership)
      .innerJoin(member, eq(member.id, groupMembership.memberId))
      .where(eq(groupMembership.groupId, id))
      .orderBy(
        desc(groupMembership.isLeader),
        asc(member.firstName),
        asc(member.lastName),
      )
  ).map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
    phone: m.phone,
    email: m.email,
    status: m.status,
    isLeader: m.isLeader,
    role: m.role,
  }));

  // Whole congregation, for the "add members" picker and the leader select.
  const all = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
    })
    .from(member)
    .where(eq(member.churchId, church.id))
    .orderBy(asc(member.firstName), asc(member.lastName));

  const candidates = all.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
  }));

  return (
    <PageContainer className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/groups">
          <ArrowLeft className="size-4" />
          Groups & Ministries
        </Link>
      </Button>

      <GroupDetail
        group={{
          id: g.id,
          name: g.name,
          type: g.type,
          description: g.description,
          meetingDay: g.meetingDay,
          meetingTime: g.meetingTime,
          isActive: g.isActive,
        }}
        members={members}
        candidates={candidates}
        canManage={canManage}
      />
    </PageContainer>
  );
}
