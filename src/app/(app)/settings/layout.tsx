import { PageContainer, PageHeader } from "@/components/app/page-header";
import { SettingsNav } from "@/components/app/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your church profile, services, giving and team."
      />
      <SettingsNav />
      {children}
    </PageContainer>
  );
}
