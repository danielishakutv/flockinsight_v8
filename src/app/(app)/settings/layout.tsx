import { redirect } from "next/navigation";
import { getAccess } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { SettingsNav } from "@/components/app/settings-nav";
import { getT } from "@/lib/i18n/server";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getT();
  const access = await getAccess();
  const canSettings = access.isOwner || access.perms.has("settings.manage");
  const canTeam = access.isOwner || access.perms.has("team.manage");
  // Finance settings answer to the finance permission, not the settings one —
  // the page behind it is the same one Finance shows, under the same gate.
  const canFinance = access.isOwner || access.perms.has("finance.view");
  if (!canSettings && !canTeam) redirect("/dashboard");

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title={t("settings.settings")}
        description={t("settings.manageYourChurchProfileServices")}
      />
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <SettingsNav
          canSettings={canSettings}
          canTeam={canTeam}
          canFinance={canFinance}
        />
        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </PageContainer>
  );
}
