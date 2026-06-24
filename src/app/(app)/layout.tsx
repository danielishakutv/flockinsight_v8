import { getIsSuperAdmin, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { unreadCount } from "@/lib/notifications";
import { Sidebar } from "@/components/app/sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { MobileNav } from "@/components/app/mobile-nav";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineIndicator } from "@/components/pwa/offline-indicator";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, church } = await requireChurch();
  const [isSuperAdmin, access, unread] = await Promise.all([
    getIsSuperAdmin(),
    getAccess(),
    unreadCount({
      churchId: church.id,
      plan: church.plan,
      country: church.country,
      userId: user.id,
    }),
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
        unread={unread}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          userName={user.name}
          userEmail={user.email}
          isSuperAdmin={isSuperAdmin}
          unread={unread}
        />
        <main className="flex-1 overflow-x-clip pb-24 lg:pb-0">{children}</main>
      </div>

      <MobileNav perms={perms} isOwner={access.isOwner} />
      <InstallPrompt />
      <OfflineIndicator />
    </div>
  );
}
