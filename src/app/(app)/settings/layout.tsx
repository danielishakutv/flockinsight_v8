import { redirect } from "next/navigation";
import { getAccess } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { SettingsNav } from "@/components/app/settings-nav";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccess();
  const canSettings = access.isOwner || access.perms.has("settings.manage");
  const canTeam = access.isOwner || access.perms.has("team.manage");
  if (!canSettings && !canTeam) redirect("/dashboard");

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your church profile, services, giving and team."
      />
      <SettingsNav canSettings={canSettings} canTeam={canTeam} />
      {children}
    </PageContainer>
  );
}
