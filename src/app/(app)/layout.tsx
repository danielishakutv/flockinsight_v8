import { redirect } from "next/navigation";
import {
  getIsSuperAdmin,
  getMustChangePassword,
  getMyChurches,
  requireChurch,
} from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { unreadCount } from "@/lib/notifications";
import { computeStanding } from "@/lib/trial";
import { getDemoState } from "@/lib/demo";
import { getPlans } from "@/lib/pricing";
import { planPriceLabel } from "@/lib/plans";
import { TrialGate, TrialBanner } from "@/components/app/trial-gate";
import { DemoBanner } from "@/components/app/demo-banner";
import { Sidebar } from "@/components/app/sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { DesktopTopbar } from "@/components/app/desktop-topbar";
import { MobileNav } from "@/components/app/mobile-nav";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SplashScreen } from "@/components/pwa/splash-screen";
import { OfflineIndicator } from "@/components/pwa/offline-indicator";
import { UploadProvider } from "@/components/media/upload-provider";
import { RecordingUploader } from "@/components/meetings/recording-uploader";
import { WhatsNewBanner } from "@/components/app/whats-new-banner";
import { PageTracker } from "@/components/analytics/page-tracker";
import { TranslationPrompt } from "@/components/app/translation-prompt";
import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getMustChangePassword()) redirect("/set-password");
  const { user, church, impersonating } = await requireChurch();
  const { locale, dict } = await getI18n();
  const [isSuperAdmin, access, unread, myChurches] = await Promise.all([
    getIsSuperAdmin(),
    getAccess(),
    unreadCount({
      churchId: church.id,
      plan: church.plan,
      country: church.country,
      userId: user.id,
    }),
    // Only to decide whether the account menu shows a switcher at all.
    getMyChurches(),
  ]);
  const perms = [...access.perms];
  const canRecord = access.isOwner || access.perms.has("attendance.manage");
  const canManageBilling = access.isOwner || access.perms.has("settings.manage");

  /*
   * How much of the fifteen minutes is left, for the banner.
   *
   * The GATE itself is not here any more — requireChurch() above has already
   * sent anybody who has not been through it to /try, which is the only way to
   * cover server actions as well as pages. This is just the countdown.
   */
  const demo = await getDemoState(church.id, church.isDemo);

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
      <I18nProvider locale={locale} dict={dict}>
        <TrialGate
          churchName={church.name}
          canManageBilling={canManageBilling}
          plans={plans}
        />
      </I18nProvider>
    );
  }
  const showTrialBanner =
    standing.state === "trialing" && (standing.daysLeft ?? 99) <= 14;

  return (
    <I18nProvider locale={locale} dict={dict}>
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      {/*
        The status bar band. viewportFit is "cover", so the app is drawn behind
        the clock and the Dynamic Island. The padding above starts the page
        below them; this covers the band so content scrolling up does not run
        under the clock, and so the topmost thing on the page — which is a
        banner, not the header, whenever one is showing — is never the thing
        that has to know about the notch. Zero height on anything without one.
      */}
      <div
        aria-hidden
        className="bg-background fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)]"
      />
      {/* Above everything, including the impersonation band: on the demo the
          single most important fact on the screen is that none of it is real. */}
      {church.isDemo && (
        <DemoBanner
          expiresAt={demo.kind === "grace" ? demo.expiresAt : null}
          verified={demo.kind === "ok" || demo.kind === "not-demo"}
        />
      )}
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
          userImage={user.image}
          isSuperAdmin={isSuperAdmin}
          churches={myChurches.map((c) => ({ id: c.id, name: c.name }))}
          activeChurchId={church.id}
          perms={perms}
          isOwner={access.isOwner}
          plan={church.plan}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar
            userName={user.name}
            userEmail={user.email}
            userImage={user.image}
            isSuperAdmin={isSuperAdmin}
            unread={unread}
            churches={myChurches.map((c) => ({ id: c.id, name: c.name }))}
            activeChurchId={church.id}
          />
          <DesktopTopbar unread={unread} canRecord={canRecord} />
          <main className="flex-1 overflow-x-clip pb-24 lg:pb-0">
            <UploadProvider>
              <WhatsNewBanner />
              {children}
              {/*
                In the shell, not in the meeting. A recording keeps uploading
                after the host leaves the call, and resumes by itself on the
                next visit — which is the difference between "it will get there"
                and "somebody has to remember to press a button".
              */}
              <RecordingUploader />
            </UploadProvider>
          </main>
        </div>

        <MobileNav perms={perms} isOwner={access.isOwner} plan={church.plan} />
      </div>
      <Toaster />
      <SplashScreen />
      <InstallPrompt />
      <OfflineIndicator />
      <PageTracker />
      <TranslationPrompt />
      <PostHogIdentify
        userId={user.id}
        churchId={church.id}
        churchName={church.name}
        plan={church.plan}
        role={access.isOwner ? "owner" : "member"}
      />
    </div>
    </I18nProvider>
  );
}
