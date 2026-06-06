import { requireChurch } from "@/lib/session";
import { Sidebar } from "@/components/app/sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { MobileNav } from "@/components/app/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, church } = await requireChurch();

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        churchName={church.name}
        userName={user.name}
        userEmail={user.email}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar userName={user.name} userEmail={user.email} />
        <main className="flex-1 overflow-x-clip pb-24 lg:pb-0">{children}</main>
      </div>

      <MobileNav />
    </div>
  );
}
