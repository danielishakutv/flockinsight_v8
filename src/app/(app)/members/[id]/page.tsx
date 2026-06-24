import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft, UsersRound } from "lucide-react";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { TYPE_LABEL, type GroupType } from "@/components/groups/labels";
import { PageContainer } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberProfile } from "@/components/members/member-profile";

export const metadata = { title: "Member" };

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("members.view");
  const canManage = await can("members.manage");

  const [m] = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      gender: member.gender,
      status: member.status,
      phone: member.phone,
      email: member.email,
      dateOfBirth: member.dateOfBirth,
      joinedAt: member.joinedAt,
      house: member.house,
      street: member.street,
      city: member.city,
      lga: member.lga,
      state: member.state,
      country: member.country,
      notes: member.notes,
    })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, church.id)))
    .limit(1);

  if (!m) notFound();

  // Groups / ministries this member belongs to.
  const memberGroups = await db
    .select({
      id: group.id,
      name: group.name,
      type: group.type,
      isLeader: groupMembership.isLeader,
      role: groupMembership.role,
    })
    .from(groupMembership)
    .innerJoin(group, eq(group.id, groupMembership.groupId))
    .where(
      and(eq(groupMembership.memberId, id), eq(group.churchId, church.id)),
    )
    .orderBy(asc(group.name));

  const name = [m.firstName, m.middleName, m.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <PageContainer className="max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/members">
          <ArrowLeft className="size-4" />
          Members
        </Link>
      </Button>
      <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
      <p className="text-muted-foreground mb-6 mt-1">Member profile</p>
      <MemberProfile member={m} canManage={canManage} />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UsersRound className="text-primary size-5" />
            Groups &amp; ministries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberGroups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Not in any group yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {memberGroups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="hover:border-primary/50 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  {g.name}
                  <span className="text-muted-foreground text-xs">
                    {g.isLeader
                      ? g.role || "Leader"
                      : g.role || TYPE_LABEL[g.type as GroupType]}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
