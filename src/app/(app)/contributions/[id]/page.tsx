import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { financeAccount } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, getAccess, requireCanAny } from "@/lib/permissions";
import {
  canManageContribution,
  canManageManagers,
  getContribution,
  getPublicContribution,
  groupOptions,
  memberOptions,
  staffCandidates,
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

  /*
   * Changing who runs a collection is a narrower right than running it: the
   * owner, or somebody with the module permission. A co-admin can record and
   * confirm money all day and still not be able to appoint another co-admin.
   */
  const mayManageManagers = await canManageManagers({
    churchId: church.id,
    userId: user.id,
    potId: id,
    hasModulePermission,
  });

  /*
   * What the link actually shows, read here rather than derived in the browser.
   *
   * The share tab builds its WhatsApp message from this, so the message and the
   * page are the same thing twice — hide a name and both lose it. Deriving the
   * published view a second time from the church's own detail would be two
   * copies of the visibility rules, and the copy that drifts is the one that
   * publishes somebody who asked not to be. Null for a draft or a link that is
   * turned off, which the share tab answers with its own card.
   */
  const [members, groups, accounts, staff, publicView] = await Promise.all([
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
    canManage ? staffCandidates(church.id) : Promise.resolve([]),
    getPublicContribution(pot.slug),
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
        staff={staff}
        canManageManagers={mayManageManagers}
        currentUserId={user.id}
        publicView={publicView}
      />
    </PageContainer>
  );
}
