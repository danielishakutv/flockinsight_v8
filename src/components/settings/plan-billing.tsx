"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Check, CreditCard, Gift, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { startCheckout } from "@/app/(app)/settings/billing/actions";
import { PLANS, planName, type PlanId } from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/i18n-provider";

type PaymentRow = {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  note: string | null;
  createdAt: string;
};

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  success: "success",
  pending: "secondary",
  failed: "destructive",
};

export function PlanBilling({
  currentPlan,
  renewsAt,
  discount,
  prices,
  basePrices,
  payments,
  status,
  trial,
  international,
}: {
  currentPlan: string;
  renewsAt: string | null;
  discount: number;
  prices: Record<PlanId, number | null>;
  basePrices: Record<PlanId, number | null>;
  payments: PaymentRow[];
  status: string | null;
  trial?: {
    state: string;
    daysLeft: number | null;
    /** Set while the church is comped with an end date. */
    waiverEndsAt?: string | null;
    waiverDaysLeft?: number | null;
  } | null;
  /**
   * Set only for a church outside Nigeria. Everything is computed on the
   * server — this component never converts a currency, so the figure on the
   * card and the figure Paystack charges come from the same calculation.
   */
  international?: {
    /** Per plan: the price in the church's own money, ready to print. */
    labels: Record<string, string | null>;
    currency: string;
    /** What the card is actually charged, in naira, for the priciest plan
     *  shown — used only in the explanatory note. */
    surchargeNgn: number;
    /** False when the rate came from the stale fallback table. */
    live: boolean;
  } | null;
}) {
  const t = useT();
  const onTrial = trial?.state === "trialing";
  const trialExpired = trial?.state === "expired";
  const comped = trial?.state === "waived";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const toasted = useRef(false);

  useEffect(() => {
    if (toasted.current || !status) return;
    toasted.current = true;
    if (status === "success") toast.success(t("settings.paymentSuccessfulPlanUpdated"));
    else if (status === "failed") toast.error(t("settings.paymentFailedOrWasCancelled"));
    else if (status === "error") toast.error(t("settings.somethingWentWrongWithThat"));
    router.replace("/settings/billing");
  }, [status, router, t]);

  const currentIndex = PLANS.findIndex((p) => p.id === currentPlan);

  function checkout(plan: PlanId) {
    setBusyPlan(plan);
    startTransition(async () => {
      const res = await startCheckout(plan);
      if (!res.ok) {
        toast.error(res.error);
        setBusyPlan(null);
        return;
      }
      if (res.url) {
        window.location.href = res.url; // to Paystack
        return;
      }
      toast.success(t("settings.planUpdated"));
      setBusyPlan(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/*
        Comped — and for how long.
        A church told "FlockInsight is on us" has no other way to find out that
        the gift has a date on it, and the first sign would otherwise be being
        asked to pay.
      */}
      {comped && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 p-4 text-white">
          <Gift className="size-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t("settings.compedTitle")}</p>
            <p className="text-sm text-white/85">
              {trial?.waiverEndsAt
                ? `Your plan is complimentary until ${new Date(trial.waiverEndsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}${
                    trial.waiverDaysLeft != null
                      ? ` — ${trial.waiverDaysLeft} day${trial.waiverDaysLeft === 1 ? "" : "s"} left`
                      : ""
                  }. We'll remind you before it ends.`
                : "Your plan is complimentary, with no end date. Nothing to pay."}
            </p>
          </div>
        </div>
      )}

      {/* Promo / trial banner */}
      {(onTrial || trialExpired) && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-2xl p-4 text-white",
            trialExpired
              ? "bg-destructive"
              : "from-primary bg-gradient-to-br to-violet-600",
          )}
        >
          <Sparkles className="size-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {trialExpired
                ? "Your free trial has ended"
                : `Launch promo: your first 7 Sundays are free`}
            </p>
            <p className="text-sm text-white/85">
              {trialExpired
                ? "Choose a plan below to keep using FlockInsight."
                : `Everything is free right now${
                    trial?.daysLeft != null ? ` — ${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left` : ""
                  }. Pick a plan any time to continue after the trial.`}
            </p>
          </div>
        </div>
      )}

      {/* Current plan */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div>
            <p className="text-muted-foreground text-xs font-semibold uppercase">
              Current plan
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="text-2xl font-extrabold">{planName(currentPlan)}</p>
              {discount > 0 && (
                <Badge variant="success">{discount}% off</Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {renewsAt
                ? `Renews ${format(parseISO(renewsAt), "MMM d, yyyy")}`
                : "No active renewal date"}
            </p>
          </div>
          <CreditCard className="text-muted-foreground size-8" />
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p, i) => {
          const isCurrent = p.id === currentPlan;
          const price = prices[p.id];
          // A church abroad sees its own money; the naira total is explained
          // once below the grid rather than repeated on every card.
          const priceLabel =
            price === null
              ? "Custom"
              : price === 0
                ? "Free"
                : (international?.labels[p.id] ??
                  `₦${price.toLocaleString()}/mo`);
          const action =
            p.id === "enterprise"
              ? "contact"
              : isCurrent
                ? "current"
                : i > currentIndex
                  ? "Upgrade"
                  : "Downgrade";
          return (
            <div
              key={p.id}
              className={cn(
                "flex flex-col rounded-2xl border p-5",
                isCurrent ? "border-primary ring-primary/30 ring-2" : "",
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold">{p.name}</h3>
                {isCurrent && <Badge>{t("settings.current")}</Badge>}
              </div>
              <p className="mt-1 text-xl font-extrabold tracking-tight">
                {onTrial && price !== null && price > 0 ? (
                  <>
                    <span className="text-muted-foreground text-base font-bold line-through decoration-2">
                      {priceLabel}
                    </span>
                    <span className="text-primary ml-2">{t("settings.freeNow")}</span>
                  </>
                ) : (
                  <>
                    {priceLabel}
                    {price !== null && price > 0 && discount > 0 && (
                      <span className="text-muted-foreground ml-1 text-xs font-normal line-through">
                        ₦{basePrices[p.id]?.toLocaleString()}
                      </span>
                    )}
                  </>
                )}
              </p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {p.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs">
                    <Check className="text-primary mt-0.5 size-3.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {action === "current" ? (
                <Button disabled variant="outline" className="mt-4 w-full">
                  Current plan
                </Button>
              ) : action === "contact" ? (
                <Button asChild variant="outline" className="mt-4 w-full">
                  <a href="mailto:hello@flockinsight.com?subject=Enterprise%20plan">
                    Contact us
                  </a>
                </Button>
              ) : (
                <Button
                  className="mt-4 w-full"
                  variant={action === "Upgrade" ? "default" : "outline"}
                  onClick={() => checkout(p.id)}
                  disabled={pending}
                >
                  {pending && busyPlan === p.id && (
                    <Loader2 className="animate-spin" />
                  )}
                  {action}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/*
        Said once, under the grid, rather than on four cards. A church abroad
        needs three facts: the money it is quoted in, the money its card is
        charged in, and why the total is above the Nigerian list price. Leaving
        the third unsaid turns a covered cost into a surprise on a statement.
      */}
      {international && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs leading-relaxed">
          Prices are shown in {international.currency}. Your card is charged in
          Nigerian naira — the total includes{" "}
          <span className="font-semibold">
            ₦{international.surchargeNgn.toLocaleString()}
          </span>{" "}
          toward international card fees, which are far higher than local ones.
          {international.live
            ? " Converted at today's exchange rate; your bank's rate may differ slightly."
            : " The exchange rate service is unreachable right now, so the converted figure is indicative — the naira amount charged is exact."}
        </p>
      )}

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.paymentHistory")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("settings.noPaymentsYet")}</p>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {planName(p.plan)}{" "}
                    <span className="text-muted-foreground">
                      · {p.gateway}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {format(parseISO(p.createdAt), "MMM d, yyyy · h:mm a")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                  </p>
                  <Badge
                    variant={STATUS_VARIANT[p.status] ?? "secondary"}
                    className="capitalize"
                  >
                    {p.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
