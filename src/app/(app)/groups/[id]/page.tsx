import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft, ChevronRight, Handshake } from "lucide-react";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listContributions } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { getT } from "@/lib/i18n/server";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PotMeter,
  PotStatusBadge,
} from "@/components/contributions/pieces";
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
  const t = await getT();
  await requireCan("groups.view");
  const canManage = await can("groups.manage");
  /*
   * A collection is money, so it is shown here only to somebody allowed to see
   * money. A group leader without `contributions.view` still runs their own
   * collections from /contributions — this is the group page, not a side door
   * around the permission.
   */
  const canSeeContributions = await can("contributions.view");

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

  // What this group is collecting, if the viewer may see it.
  const pots = canSeeContributions
    ? await listContributions(church.id, { groupIds: [id] })
    : [];

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

      {pots.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Handshake className="text-primary size-5" />
              {t("contributions.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pots.map((c) => (
              <Link
                key={c.id}
                href={`/contributions/${c.id}`}
                className="hover:bg-accent block rounded-xl border p-3 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{c.title}</span>
                      <PotStatusBadge status={c.status} />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatMoney(c.raised, church.currency)}
                      {c.target
                        ? ` ${t("contributions.ofTarget", {
                            amount: formatMoney(c.target, church.currency),
                          })}`
                        : ""}{" "}
                      · {t("common.people", { count: c.givers })}
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground mt-1 size-4 shrink-0" />
                </div>
                <PotMeter
                  raised={c.raised}
                  pending={c.pending}
                  target={c.target}
                  currency={church.currency}
                  className="mt-2"
                />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
