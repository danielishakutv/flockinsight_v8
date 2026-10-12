"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, LogOut, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  startCheckout,
  requestTrialExtension,
} from "@/app/(app)/settings/billing/actions";
import { signOut } from "@/lib/auth-client";
import type { PlanId } from "@/lib/plans";
import { freeMonthsLabel, type BillingCycle } from "@/lib/billing-cycle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

type PlanOpt = {
  id: PlanId;
  name: string;
  tagline: string;
  priceLabel: string;
  /** The yearly total, worked out on the server. Null for a custom plan. */
  annualPriceLabel: string | null;
  /** Nothing to pay (a 100% discount): the button activates rather than charges. */
  free?: boolean;
};

/** Full-page block shown when a church's free trial has ended and it hasn't paid. */
export function TrialGate({
  churchName,
  canManageBilling,
  plans,
  annualFreeMonths,
  currencyNote = null,
  lapsed = false,
}: {
  churchName: string;
  canManageBilling: boolean;
  plans: PlanOpt[];
  /** Months free for paying a year. 0 hides the choice entirely. */
  annualFreeMonths: number;
  /**
   * For a church abroad: the money it is quoted in, the money its card is
   * charged in, and the exact card fee. Null at home.
   */
  currencyNote?: string | null;
  /** A paid plan ran out, as opposed to the free trial. */
  lapsed?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const annual = cycle === "annual";
  const [paying, setPaying] = useState<PlanId | null>(null);
  const [requesting, startRequest] = useTransition();
  const [requested, setRequested] = useState(false);

  // Back from Paystack into a page restored from the bfcache: give the
  // buttons back, or the only screen this church can use is a dead one.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPaying(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function pay(plan: PlanId) {
    if (paying) return;
    setPaying(plan);
    let res: Awaited<ReturnType<typeof startCheckout>>;
    try {
      res = await startCheckout(plan, cycle);
    } catch (e) {
      // A lost signal, or a tab older than the last deploy. This page is the
      // whole app for a church behind the paywall, so a spinner that never
      // stops is a church that cannot pay.
      console.error("trial gate: could not start checkout", e);
      toast.error(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "You appear to be offline. Check your connection and try again. Nothing was charged."
          : "We couldn't reach FlockInsight. Reload the page (the app may have just been updated) and try again. Nothing was charged.",
      );
      setPaying(null);
      return;
    }
    if (!res.ok) {
      toast.error(res.error);
      setPaying(null);
      return;
    }
    // Leaving for Paystack: `paying` stays set so a second tap cannot open a
    // second checkout while the page is still on its way out.
    if (res.url) window.location.assign(res.url);
    else {
      setPaying(null);
      router.refresh();
    }
  }

  function requestExtension() {
    startRequest(async () => {
      const res = await requestTrialExtension();
      if (res.ok) {
        setRequested(true);
        toast.success(t("app.requestSentToOurTeam"));
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-muted/40 grid min-h-dvh place-items-center px-4 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-10">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-extrabold">
            Flock<span className="text-primary">Insight</span>
          </span>
          <button
            type="button"
            onClick={() => signOut().then(() => router.push("/login"))}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>

        <div className="bg-card rounded-3xl border p-6 shadow-sm sm:p-8">
          <div className="bg-primary/10 text-primary mb-4 grid size-12 place-items-center rounded-2xl">
            <CalendarClock className="size-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {lapsed ? "Your plan has expired" : "Your free trial has ended"}
          </h1>
          <p className="text-muted-foreground mt-2">
            {lapsed
              ? `${churchName}'s FlockInsight plan has run out. To keep using attendance, members, giving and everything else, renew below.`
              : `${churchName} enjoyed its first 7 Sundays on FlockInsight 🎉. To keep using attendance, members, giving and everything else, choose a plan below.`}
          </p>

          {canManageBilling ? (
            <>
              {annualFreeMonths > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <div
                    role="radiogroup"
                    aria-label="Billing period"
                    className="bg-muted inline-flex rounded-full p-1"
                  >
                    {(["monthly", "annual"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={cycle === c}
                        onClick={() => setCycle(c)}
                        className={cn(
                          "min-h-11 rounded-full px-5 text-sm font-bold transition",
                          cycle === c
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {c === "monthly" ? "Monthly" : "Yearly"}
                      </button>
                    ))}
                  </div>
                  <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-bold">
                    {freeMonthsLabel(annualFreeMonths)}
                  </span>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-bold">{p.name}</p>
                      <p className="text-muted-foreground text-sm">{p.tagline}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-extrabold tabular-nums">
                        {annual ? (p.annualPriceLabel ?? p.priceLabel) : p.priceLabel}
                      </span>
                      <Button onClick={() => pay(p.id)} disabled={!!paying}>
                        {paying === p.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        {/*
                          What is being bought, on the button. "Pay" beside a
                          yearly figure leaves a church to guess whether the
                          next screen is asking for one month or twelve.
                        */}
                        {p.free ? "Activate" : annual ? "Pay for a year" : "Pay"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {currencyNote && (
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  {currencyNote}
                </p>
              )}

              <div className="mt-6 border-t pt-5">
                {requested ? (
                  <p className="text-success flex items-center gap-2 text-sm font-medium">
                    <Check className="size-4" /> Extension request sent — our team
                    will be in touch.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-muted-foreground text-sm">
                      Need more time to decide?
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={requestExtension}
                      disabled={requesting}
                    >
                      {requesting && <Loader2 className="size-4 animate-spin" />}
                      Request a trial extension
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-2xl border p-4">
              <p className="text-sm">
                Please ask your church&apos;s owner or an admin to renew the
                FlockInsight subscription so your team can continue.
              </p>
            </div>
          )}
        </div>

        <p className="text-muted-foreground mt-4 text-center text-xs">
          Questions? <Link href="/help/support" className="font-medium underline">{t("app.contactUs")}</Link>.
          Your church&apos;s data is safe and waiting for you.
        </p>
      </div>
    </div>
  );
}

/** Slim countdown banner during the last stretch of the free trial. */
export function TrialBanner({
  daysLeft,
  canManageBilling,
}: {
  daysLeft: number;
  canManageBilling: boolean;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium text-white",
        daysLeft <= 3 ? "bg-destructive" : "bg-primary",
      )}
    >
      <Sparkles className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {daysLeft <= 0
          ? "Your free trial ends today."
          : `Free trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`}{" "}
        {canManageBilling && (
          <Link href="/settings/billing" className="underline">
            Choose a plan
          </Link>
        )}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("app.dismiss")}
        className="shrink-0 opacity-80 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
