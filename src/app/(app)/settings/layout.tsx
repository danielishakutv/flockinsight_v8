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
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Settings"
        description="Manage your church profile, services, giving and team."
      />
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <SettingsNav canSettings={canSettings} canTeam={canTeam} />
        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </PageContainer>
  );
}
