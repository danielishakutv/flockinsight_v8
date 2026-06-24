import { getIsSuperAdmin, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { Sidebar } from "@/components/app/sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { MobileNav } from "@/components/app/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, church } = await requireChurch();
  const [isSuperAdmin, access] = await Promise.all([
    getIsSuperAdmin(),
    getAccess(),
  ]);
  const perms = [...access.perms];

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        churchName={church.name}
        userName={user.name}
        userEmail={user.email}
        isSuperAdmin={isSuperAdmin}
        perms={perms}
        isOwner={access.isOwner}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          userName={user.name}
          userEmail={user.email}
          isSuperAdmin={isSuperAdmin}
        />
        <main className="flex-1 overflow-x-clip pb-24 lg:pb-0">{children}</main>
      </div>

      <MobileNav perms={perms} isOwner={access.isOwner} />
    </div>
  );
}
