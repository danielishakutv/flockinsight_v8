"use client";

import { useState, useTransition } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlanOpt = { id: PlanId; name: string; tagline: string; priceLabel: string };

/** Full-page block shown when a church's free trial has ended and it hasn't paid. */
export function TrialGate({
  churchName,
  canManageBilling,
  plans,
}: {
  churchName: string;
  canManageBilling: boolean;
  plans: PlanOpt[];
}) {
  const router = useRouter();
  const [paying, setPaying] = useState<PlanId | null>(null);
  const [requesting, startRequest] = useTransition();
  const [requested, setRequested] = useState(false);

  async function pay(plan: PlanId) {
    setPaying(plan);
    const res = await startCheckout(plan);
    if (!res.ok) {
      toast.error(res.error);
      setPaying(null);
      return;
    }
    if (res.url) window.location.href = res.url;
    else router.refresh();
  }

  function requestExtension() {
    startRequest(async () => {
      const res = await requestTrialExtension();
      if (res.ok) {
        setRequested(true);
        toast.success("Request sent to our team.");
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-muted/40 grid min-h-dvh place-items-center px-4 py-10">
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
            Your free trial has ended
          </h1>
          <p className="text-muted-foreground mt-2">
            {churchName} enjoyed its first 7 Sundays on FlockInsight 🎉. To keep
            using attendance, members, giving and everything else, choose a plan
            below.
          </p>

          {canManageBilling ? (
            <>
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
                        {p.priceLabel}
                      </span>
                      <Button onClick={() => pay(p.id)} disabled={!!paying}>
                        {paying === p.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Pay
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

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
          Questions? <Link href="/help/support" className="font-medium underline">Contact us</Link>.
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
        aria-label="Dismiss"
        className="shrink-0 opacity-80 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
