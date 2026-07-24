import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, ne, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getHousehold } from "@/lib/households";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { HouseholdDetail } from "@/components/members/household-detail";

export const metadata = { title: "Household" };

export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("members.view");
  const canManage = await can("members.manage");

  const detail = await getHousehold(church.id, id);
  if (!detail) notFound();

  // Members who can be added (not already in this household).
  const candidates = canManage
    ? await db
        .select({
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          isMinor: member.isMinor,
        })
        .from(member)
        .where(
          and(
            eq(member.churchId, church.id),
            or(ne(member.householdId, id), isNull(member.householdId)),
          ),
        )
        .orderBy(asc(member.firstName), asc(member.lastName))
    : [];

  return (
    <PageContainer className="max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/members/households">
          <ArrowLeft className="size-4" />
          Households
        </Link>
      </Button>
      <HouseholdDetail
        household={detail}
        canManage={canManage}
        candidates={candidates.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
          isMinor: c.isMinor,
        }))}
      />
    </PageContainer>
  );
}
