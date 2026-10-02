import { requireChurch } from "@/lib/session";
import { getAccess, requireCanAny } from "@/lib/permissions";
import {
  groupOptions,
  groupsLedBy,
  listContributions,
  memberOptions,
  unlinkedContributorCount,
} from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { ContributionsList } from "@/components/contributions/contributions-list";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Group contributions" };

export default async function ContributionsPage() {
  const { church, user } = await requireChurch();
  const t = await getT();

  /*
   * A group leader reaches this page without `contributions.view`.
   *
   * That is the point of the module: the choir leader who runs the levy is
   * usually not an administrator. `groups.view` is the baseline permission a
   * leader will already hold, so the page admits them and then shows them only
   * the collections for groups they lead.
   */
  await requireCanAny(["contributions.view", "contributions.manage", "groups.view"]);

  const access = await getAccess();
  const hasModule =
    access.isOwner ||
    access.perms.has("contributions.view") ||
    access.perms.has("contributions.manage");
  const canManageAll = access.isOwner || access.perms.has("contributions.manage");

  const led = canManageAll ? [] : await groupsLedBy(church.id, user.id);

  // Without the module permission, somebody sees the collections of the groups
  // they lead and nothing else.
  const rows = await listContributions(
    church.id,
    hasModule ? {} : { groupIds: led },
  );

  const [groups, members, unmatched] = await Promise.all([
    groupOptions(church.id),
    canManageAll ? memberOptions(church.id) : Promise.resolve([]),
    canManageAll ? unlinkedContributorCount(church.id) : Promise.resolve(0),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const collecting = rows.filter((r) => r.status === "open");
  const totalRaised = rows.reduce((a, r) => a + r.raised, 0);
  const totalHeld = rows.reduce((a, r) => a + r.balance, 0);

  return (
    <PageContainer>
      <PageHeader
        title={t("contributions.title")}
        description={
          rows.length === 0
            ? t("contributions.subtitle")
            : `${collecting.length} collecting · ${formatMoney(totalRaised, church.currency)} collected · ${formatMoney(totalHeld, church.currency)} still held`
        }
      />
      <ContributionsList
        rows={rows}
        currency={church.currency}
        today={today}
        canCreate={canManageAll || led.length > 0}
        canSeeMatches={canManageAll}
        unmatchedCount={unmatched}
        groups={groups}
        members={members}
        restrictToGroupIds={canManageAll ? null : led}
      />
    </PageContainer>
  );
}
