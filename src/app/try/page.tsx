import { redirect } from "next/navigation";
import { getDemoChurch, getDemoState } from "@/lib/demo";
import { requireUser } from "@/lib/session";
import { DemoGate } from "@/components/app/demo-gate";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

export const metadata = { title: "Try the demo" };
export const dynamic = "force-dynamic";

/**
 * The door to the demonstration church.
 *
 * Deliberately OUTSIDE the (app) group, and that is the whole point of this
 * file. The gate used to be a branch in the app layout, which meant it only
 * ran while a page was being rendered — so anybody who knew the shared demo
 * password could call a server action directly and never see it. The rule now
 * lives in requireChurch(), which every page, every action and every API route
 * in the app already passes through, and a closed gate sends them here.
 *
 * Which means this page cannot itself call requireChurch(): that would be a
 * redirect loop. It asks for a signed-in user and reads the demo church
 * directly.
 */
export default async function TryDemoPage() {
  const { user } = await requireUser();
  void user;

  const demo = await getDemoChurch();
  // Nothing is a demo right now. Nobody should be here; the dashboard decides
  // where they actually belong.
  if (!demo) redirect("/dashboard");

  const state = await getDemoState(demo.id, true);
  // Already through the door — back to the app rather than a form they have
  // already filled in.
  if (state.kind === "ok" || state.kind === "grace") redirect("/dashboard");

  const { locale, dict } = await getI18n();

  return (
    <I18nProvider locale={locale} dict={dict}>
      <DemoGate
        churchName={demo.name}
        mode={state.kind === "expired" ? "verify" : "ask"}
        email={state.kind === "expired" ? state.email : undefined}
        otpSent={state.kind === "expired" ? state.otpSent : false}
      />
      <Toaster />
    </I18nProvider>
  );
}
