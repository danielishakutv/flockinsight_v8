import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft, UsersRound } from "lucide-react";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { TYPE_LABEL, type GroupType } from "@/components/groups/labels";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberProfile } from "@/components/members/member-profile";
import { MemberFamily } from "@/components/members/member-family";

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
      photoUrl: member.photoUrl,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      gender: member.gender,
      status: member.status,
      isMinor: member.isMinor,
      guardianId: member.guardianId,
      relationship: member.relationship,
      phone: member.phone,
      email: member.email,
      dateOfBirth: member.dateOfBirth,
      joinedAt: member.joinedAt,
      weddingDate: member.weddingDate,
      baptized: member.baptized,
      baptismDate: member.baptismDate,
      anniversaries: member.anniversaries,
      house: member.house,
      street: member.street,
      city: member.city,
      lga: member.lga,
      state: member.state,
      country: member.country,
      notes: member.notes,
      userId: member.userId,
    })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, church.id)))
    .limit(1);

  if (!m) notFound();

  const [memberGroups, children, guardianOptions] = await Promise.all([
    // Groups / ministries this member belongs to.
    db
      .select({
        id: group.id,
        name: group.name,
        type: group.type,
        isLeader: groupMembership.isLeader,
        role: groupMembership.role,
      })
      .from(groupMembership)
      .innerJoin(group, eq(group.id, groupMembership.groupId))
      .where(and(eq(groupMembership.memberId, id), eq(group.churchId, church.id)))
      .orderBy(asc(group.name)),
    // This member's own children.
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        relationship: member.relationship,
        dateOfBirth: member.dateOfBirth,
        status: member.status,
      })
      .from(member)
      .where(and(eq(member.guardianId, id), eq(member.churchId, church.id)))
      .orderBy(asc(member.firstName), asc(member.lastName)),
    // Adults who can be picked as a guardian (everyone but minors & this member).
    db
      .select({ id: member.id, firstName: member.firstName, lastName: member.lastName })
      .from(member)
      .where(
        and(
          eq(member.churchId, church.id),
          eq(member.isMinor, false),
          ne(member.id, id),
        ),
      )
      .orderBy(asc(member.firstName), asc(member.lastName)),
  ]);

  const name = [m.firstName, m.middleName, m.lastName]
    .filter(Boolean)
    .join(" ");
  const guardians = guardianOptions.map((g) => ({
    id: g.id,
    name: [g.firstName, g.lastName].filter(Boolean).join(" "),
  }));
  // The guardian is a non-minor member (validated on save), so they're in the
  // candidate list — resolve their name from it instead of a self-join.
  const guardianName = m.guardianId
    ? guardians.find((g) => g.id === m.guardianId)?.name ?? null
    : null;
  const childList = children.map((c) => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" "),
    relationship: c.relationship,
    dateOfBirth: c.dateOfBirth,
    status: c.status,
  }));

  return (
    <PageContainer className="max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/members">
          <ArrowLeft className="size-4" />
          Members
        </Link>
      </Button>
      <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
      <p className="text-muted-foreground mb-6 mt-1">
        {m.isMinor ? "Child profile" : "Member profile"}
      </p>
      <MemberProfile
        member={m}
        canManage={canManage}
        isTeamMember={!!m.userId}
        guardians={guardians}
        guardianName={guardianName}
      />

      <MemberFamily
        parentId={m.id}
        parentName={name}
        isMinor={m.isMinor}
        guardianId={m.guardianId}
        guardianName={guardianName}
        kids={childList}
        canManage={canManage}
      />

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
