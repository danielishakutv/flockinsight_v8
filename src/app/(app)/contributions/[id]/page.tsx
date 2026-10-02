import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { financeAccount } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, getAccess, requireCanAny } from "@/lib/permissions";
import {
  canManageContribution,
  getContribution,
  groupOptions,
  memberOptions,
} from "@/lib/contributions";
import { siteUrl } from "@/lib/site";
import { PageContainer } from "@/components/app/page-header";
import { ContributionDetail } from "@/components/contributions/contribution-detail";

export const metadata = { title: "Collection" };

export default async function ContributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church, user } = await requireChurch();
  await requireCanAny(["contributions.view", "contributions.manage", "groups.view"]);

  const pot = await getContribution(church.id, id);
  if (!pot) notFound();

  const access = await getAccess();
  const hasModulePermission =
    access.isOwner || access.perms.has("contributions.manage");

  const canManage = await canManageContribution({
    churchId: church.id,
    userId: user.id,
    potId: id,
    hasModulePermission,
  });

  /*
   * A group leader with no `contributions.view` may only open their own group's
   * collection. Without this, the id in the URL would be enough to read any
   * collection in the church.
   */
  const canRead =
    access.isOwner ||
    access.perms.has("contributions.view") ||
    access.perms.has("contributions.manage") ||
    canManage;
  if (!canRead) notFound();

  const canPostToFinance = await can("finance.manage");

  const [members, groups, accounts] = await Promise.all([
    canManage ? memberOptions(church.id) : Promise.resolve([]),
    canManage ? groupOptions(church.id) : Promise.resolve([]),
    canPostToFinance
      ? db
          .select({ id: financeAccount.id, name: financeAccount.name })
          .from(financeAccount)
          .where(
            and(
              eq(financeAccount.churchId, church.id),
              eq(financeAccount.isActive, true),
            ),
          )
          .orderBy(asc(financeAccount.name))
      : Promise.resolve([]),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PageContainer>
      <ContributionDetail
        pot={pot}
        currency={church.currency}
        today={today}
        canManage={canManage}
        canPostToFinance={canPostToFinance}
        siteUrl={siteUrl()}
        members={members}
        groups={groups}
        financeAccounts={accounts}
        currentUserId={user.id}
      />
    </PageContainer>
  );
}
