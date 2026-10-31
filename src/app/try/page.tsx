import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getDemoChurch, getDemoState } from "@/lib/demo";
import { getSession } from "@/lib/session";
import { dialCountry } from "@/lib/dial-codes";
import { DemoGate } from "@/components/app/demo-gate";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

export const metadata = {
  title: "Try the live demo",
  description:
    "Walk around a real FlockInsight church workspace with sample data — members, attendance, giving, follow-up. No sign-up.",
  // A door, not content: it says nothing a search result should show.
  robots: { index: false, follow: true },
};
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
 * redirect loop. It reads the session and the demo church directly.
 *
 * It is also the PUBLIC door now. Signed out, it shows the same form, and
 * filling it in signs the visitor in as the demo account on the server — the
 * "Try the live demo" buttons on the login and walkthrough pages land here.
 */
export default async function TryDemoPage() {
  const session = await getSession();
  const demo = await getDemoChurch();
  const { locale, dict } = await getI18n();

  if (!demo) {
    // Signed in: the dashboard decides where they actually belong.
    if (session?.user) redirect("/dashboard");
    // Signed out: a link to the demo should never end on a login form.
    return <DemoClosed />;
  }

  /*
   * Signed out — the public door. Filling it in signs them in as the demo
   * account (see enterDemo), so the password never has to be published.
   */
  if (!session?.user) {
    const h = await headers();
    const detected = dialCountry(h.get("cf-ipcountry"))?.iso2 ?? null;
    return (
      <I18nProvider locale={locale} dict={dict}>
        <DemoGate churchName={demo.name} mode="ask" signedOut detectedCountry={detected} />
        <Toaster />
      </I18nProvider>
    );
  }

  const state = await getDemoState(demo.id, true);
  // Already through the door — back to the app rather than a form they have
  // already filled in.
  if (state.kind === "ok" || state.kind === "grace") redirect("/dashboard");

  const h = await headers();
  const detected = dialCountry(h.get("cf-ipcountry"))?.iso2 ?? null;
  return (
    <I18nProvider locale={locale} dict={dict}>
      <DemoGate
        churchName={demo.name}
        mode={state.kind === "expired" ? "verify" : "ask"}
        email={state.kind === "expired" ? state.email : undefined}
        otpSent={state.kind === "expired" ? state.otpSent : false}
        detectedCountry={detected}
      />
      <Toaster />
    </I18nProvider>
  );
}

/** No church is marked as the demo: say so, and offer the human version. */
function DemoClosed() {
  return (
    <div className="bg-muted/30 grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4 text-center">
        <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
          <FlaskConical className="size-7" />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight">The live demo is closed just now</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;re rebuilding it. Book a free 20-minute walkthrough and we&apos;ll show
          you round on your own church&apos;s numbers instead.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/demo">Book a walkthrough</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/signup">Start free</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
