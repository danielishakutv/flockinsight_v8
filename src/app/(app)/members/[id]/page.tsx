import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft, ChevronRight, HandCoins, Home, UsersRound } from "lucide-react";
import { db } from "@/db";
import {
  group,
  groupMembership,
  household,
  invitation,
  member,
  role,
  staff,
  staffInvite,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { householdOptions } from "@/lib/households";
import { getMemberPledges, cadenceLabel } from "@/lib/projects";
import { formatMoney } from "@/lib/money";
import { siteUrl } from "@/lib/site";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { TYPE_LABEL, type GroupType } from "@/components/groups/labels";
import { PageContainer } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberProfile } from "@/components/members/member-profile";
import { MemberFamily } from "@/components/members/member-family";
import { MemberUpdateLink } from "@/components/members/member-update-link";
import {
  MemberAccessCard,
  type MemberAccess,
} from "@/components/members/member-access-card";

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
      householdId: member.householdId,
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
      updateToken: member.updateToken,
    })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, church.id)))
    .limit(1);

  if (!m) notFound();

  const [
    memberGroups,
    children,
    guardianOptions,
    households,
    householdRow,
    householdSiblings,
    memberPledges,
  ] = await Promise.all([
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
      // Household options for the edit form's picker.
      householdOptions(church.id),
      // This member's household (name).
      m.householdId
        ? db
            .select({ id: household.id, name: household.name })
            .from(household)
            .where(and(eq(household.id, m.householdId), eq(household.churchId, church.id)))
            .limit(1)
        : Promise.resolve([]),
      // Other people in the same household.
      m.householdId
        ? db
            .select({
              id: member.id,
              firstName: member.firstName,
              lastName: member.lastName,
              isMinor: member.isMinor,
            })
            .from(member)
            .where(
              and(
                eq(member.householdId, m.householdId),
                eq(member.churchId, church.id),
                ne(member.id, id),
              ),
            )
            .orderBy(asc(member.firstName), asc(member.lastName))
        : Promise.resolve([]),
      // This member's pledges across projects (their statement).
      getMemberPledges(church.id, id),
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
  const householdName = householdRow[0]?.name ?? null;

  // App access: can this person sign in, are they mid-invitation, or neither?
  // Only loaded for admins, since only they can act on it.
  const canManageTeam = await can("team.manage");
  let access: MemberAccess = { state: "none" };
  let accessRoles: { id: string; name: string; description: string | null }[] = [];

  if (canManageTeam) {
    if (m.userId) {
      const [s] = await db
        .select({ orgRole: staff.role, roleName: role.name })
        .from(staff)
        .leftJoin(role, eq(role.id, staff.roleId))
        .where(
          and(eq(staff.organizationId, church.id), eq(staff.userId, m.userId)),
        )
        .limit(1);
      access = {
        state: "active",
        roleName: s?.roleName ?? null,
        isOwner: s?.orgRole === "owner",
      };
    } else {
      const [inv] = await db
        .select({ id: invitation.id, email: invitation.email })
        .from(staffInvite)
        .innerJoin(invitation, eq(invitation.id, staffInvite.invitationId))
        .where(
          and(
            eq(staffInvite.memberId, id),
            eq(invitation.organizationId, church.id),
            eq(invitation.status, "pending"),
          ),
        )
        .limit(1);
      if (inv) {
        access = { state: "invited", email: inv.email, invitationId: inv.id };
      }
    }

    accessRoles = await db
      .select({
        id: role.id,
        name: role.name,
        description: role.description,
      })
      .from(role)
      .where(and(eq(role.churchId, church.id), eq(role.isSystem, false)))
      .orderBy(asc(role.name));
  }

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
      {canManageTeam && !m.isMinor && (
        <div className="mb-4">
          <MemberAccessCard
            member={{ id: m.id, name, email: m.email }}
            access={access}
            roles={accessRoles}
          />
        </div>
      )}

      <MemberProfile
        member={m}
        canManage={canManage}
        isTeamMember={!!m.userId}
        guardians={guardians}
        guardianName={guardianName}
        households={households}
      />

      <MemberFamily
        parentId={m.id}
        parentName={name}
        isMinor={m.isMinor}
        guardianId={m.guardianId}
        guardianName={guardianName}
        kids={childList}
        canManage={canManage}
        householdId={m.householdId}
        households={households}
      />

      {canManage && (
        <MemberUpdateLink
          memberId={m.id}
          initialUrl={m.updateToken ? `${siteUrl()}/m/${m.updateToken}` : null}
          hasPhone={!!m.phone}
          hasEmail={!!m.email}
          smsAvailable={smsAvailableForCountry(church.country)}
        />
      )}

      {m.householdId && householdName && (
        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Home className="text-primary size-5" />
              Household
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/members/households/${m.householdId}`}>
                {householdName}
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {householdSiblings.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                The only member of{" "}
                <Link
                  href={`/members/households/${m.householdId}`}
                  className="text-primary font-medium underline"
                >
                  {householdName}
                </Link>{" "}
                so far.
              </p>
            ) : (
              <div className="space-y-2">
                {householdSiblings.map((s) => (
                  <Link
                    key={s.id}
                    href={`/members/${s.id}`}
                    className="hover:bg-accent flex items-center gap-3 rounded-xl px-2 py-2 transition-colors"
                  >
                    <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold">
                      {[s.firstName?.[0], s.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
                    </div>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {[s.firstName, s.lastName].filter(Boolean).join(" ")}
                    </span>
                    <ChevronRight className="text-muted-foreground size-4" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {memberPledges.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <HandCoins className="text-primary size-5" />
              Pledges
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {memberPledges.map((pl) => (
              <Link
                key={pl.id}
                href={`/giving/projects/${pl.projectId}`}
                className="hover:bg-accent flex items-center gap-3 rounded-xl border p-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{pl.projectName}</span>
                    {pl.status === "completed" || pl.paid >= pl.amount ? (
                      <Badge variant="success">Fulfilled</Badge>
                    ) : pl.status === "cancelled" ? (
                      <Badge variant="outline">Cancelled</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {cadenceLabel(pl.cadence, pl.cadenceLabel)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatMoney(pl.paid, church.currency)} of{" "}
                    {formatMoney(pl.amount, church.currency)} paid
                    {pl.outstanding > 0 && pl.status === "active"
                      ? ` · ${formatMoney(pl.outstanding, church.currency)} outstanding`
                      : ""}
                  </p>
                </div>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
