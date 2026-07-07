import { redirect } from "next/navigation";
import { getIsSuperAdmin, getMustChangePassword, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { unreadCount } from "@/lib/notifications";
import { computeStanding } from "@/lib/trial";
import { getPlans } from "@/lib/pricing";
import { planPriceLabel } from "@/lib/plans";
import { TrialGate, TrialBanner } from "@/components/app/trial-gate";
import { Sidebar } from "@/components/app/sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { DesktopTopbar } from "@/components/app/desktop-topbar";
import { MobileNav } from "@/components/app/mobile-nav";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineIndicator } from "@/components/pwa/offline-indicator";
import { UploadProvider } from "@/components/media/upload-provider";
import { WhatsNewBanner } from "@/components/app/whats-new-banner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getMustChangePassword()) redirect("/set-password");
  const { user, church, impersonating } = await requireChurch();
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
  const canRecord = access.isOwner || access.perms.has("attendance.manage");
  const canManageBilling = access.isOwner || access.perms.has("settings.manage");

  // "First 7 Sundays free" gate. A superadmin acting-as a church bypasses it so
  // they can still help. Only an EXPIRED trial (no payment/waiver) blocks.
  const standing = computeStanding(church);
  if (standing.gated && !impersonating) {
    const plans = (await getPlans())
      .filter((p) => p.priceMonthly && p.priceMonthly > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        priceLabel: planPriceLabel(p),
      }));
    return (
      <TrialGate
        churchName={church.name}
        canManageBilling={canManageBilling}
        plans={plans}
      />
    );
  }
  const showTrialBanner =
    standing.state === "trialing" && (standing.daysLeft ?? 99) <= 14;

  return (
    <div className="flex min-h-dvh flex-col">
      {impersonating && <ImpersonationBanner churchName={church.name} />}
      {showTrialBanner && standing.daysLeft != null && (
        <TrialBanner
          daysLeft={standing.daysLeft}
          canManageBilling={canManageBilling}
        />
      )}
      <div className="flex min-h-0 flex-1">
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
            unread={unread}
          />
          <DesktopTopbar unread={unread} canRecord={canRecord} />
          <main className="flex-1 overflow-x-clip pb-24 lg:pb-0">
            <UploadProvider>
              <WhatsNewBanner />
              {children}
            </UploadProvider>
          </main>
        </div>

        <MobileNav perms={perms} isOwner={access.isOwner} />
      </div>
      <InstallPrompt />
      <OfflineIndicator />
    </div>
  );
}
