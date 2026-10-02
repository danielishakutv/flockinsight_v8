import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { dismissedPeople, unmatchedPeople } from "@/lib/contribution-merge";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { MatchPanel } from "@/components/contributions/match-panel";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "People to match" };

export default async function ContributionPeoplePage() {
  const { church } = await requireChurch();
  const t = await getT();

  /*
   * Needs the module AND the register.
   *
   * Linking a contributor reads and writes member records, so somebody who may
   * only see collections has no business here — and a group leader, who can run
   * their own collection, is deliberately not given the power to reshape the
   * church's register from it.
   */
  await requireCan("contributions.manage");
  await requireCan("members.view");
  const canAddMembers = await can("members.manage");

  const [people, dismissed] = await Promise.all([
    unmatchedPeople(church.id),
    dismissedPeople(church.id),
  ]);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/contributions">
          <ArrowLeft className="size-4" aria-hidden /> {t("contributions.title")}
        </Link>
      </Button>
      <PageHeader
        title={t("contributions.matchTitle")}
        description={t("contributions.matchSubtitle")}
      />
      <MatchPanel
        people={people}
        dismissed={dismissed}
        currency={church.currency}
        canAddMembers={canAddMembers}
      />
    </PageContainer>
  );
}
