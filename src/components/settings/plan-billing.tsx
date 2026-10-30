"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Check, CreditCard, Gift, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { startCheckout } from "@/app/(app)/settings/billing/actions";
import {
  annualSaving,
  annualTotal,
  freeMonthsLabel,
  monthlyEquivalent,
  type BillingCycle,
} from "@/lib/billing-cycle";
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

/** A plan the church may choose: a tier, or a custom plan made at /superadmin/plans. */
type BillingPlan = { key: string; name: string; features: string[]; custom: boolean };

export function PlanBilling({
  currentPlan,
  currentName,
  plans,
  renewsAt,
  discount,
  prices,
  annualPrices,
  annualFreeMonths,
  basePrices,
  payments,
  status,
  trial,
  international,
}: {
  /** The church's plan key: "growth", or "custom:<id>". */
  currentPlan: string;
  currentName: string;
  plans: BillingPlan[];
  renewsAt: string | null;
  discount: number;
  /** By plan key. */
  prices: Record<string, number | null>;
  /** The yearly total per plan, worked out on the server. */
  annualPrices: Record<string, number | null>;
  /** How many of the twelve months are free when paying for a year. */
  annualFreeMonths: number;
  basePrices: Record<string, number | null>;
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
    /** The same, for a year. One card surcharge rather than twelve. */
    annualLabels: Record<string, string | null>;
    /**
     * The undiscounted prices, converted and carrying the same fee, for the
     * struck-through "was" figure. A naira list price struck through beside a
     * converted price read as a 92% discount.
     */
    baseLabels?: Record<string, string | null>;
    annualBaseLabels?: Record<string, string | null>;
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
  /*
   * Set once Paystack's URL is in hand and never cleared on the way out. The
   * transition ends the moment the action returns, long before a slow phone
   * has left the page — and a second tap in that gap opened a second checkout
   * and a second pending payment nobody made.
   */
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    // Back from Paystack into a page restored from the bfcache: the buttons
    // must work again, or the church is stuck looking at disabled ones.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setRedirecting(false);
        setBusyPlan(null);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const annual = cycle === "annual";
  const toasted = useRef(false);

  useEffect(() => {
    if (toasted.current || !status) return;
    toasted.current = true;
    if (status === "success") toast.success(t("settings.paymentSuccessfulPlanUpdated"));
    else if (status === "failed") toast.error(t("settings.paymentFailedOrWasCancelled"));
    // Not a failure: a transfer still in flight, or Paystack slow to answer.
    // The webhook settles it; saying "failed" is how churches came to pay twice.
    else if (status === "pending")
      toast.info(
        "Your payment is being confirmed. Your plan updates by itself as soon as Paystack confirms it — there is no need to pay again.",
        { duration: 10_000 },
      );
    else if (status === "error") toast.error(t("settings.somethingWentWrongWithThat"));
    router.replace("/settings/billing");
  }, [status, router, t]);

  const currentIndex = plans.findIndex((p) => p.key === currentPlan);
  const currentIsTier = plans[currentIndex]?.custom === false;

  function checkout(plan: string) {
    if (redirecting) return;
    setBusyPlan(plan);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof startCheckout>>;
      try {
        res = await startCheckout(plan, cycle);
      } catch (e) {
        // A lost connection, or a tab older than the last deploy. Never a
        // spinner that spins for ever: say which, and give the button back.
        console.error("billing: could not start checkout", e);
        toast.error(
          typeof navigator !== "undefined" && !navigator.onLine
            ? "You appear to be offline. Check your connection and try again. Nothing was charged."
            : "We couldn't reach FlockInsight. Reload the page (the app may have just been updated) and try again. Nothing was charged.",
        );
        setBusyPlan(null);
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        setBusyPlan(null);
        return;
      }
      if (res.url) {
        setRedirecting(true);
        window.location.href = res.url; // to Paystack
        return;
      }
      toast.success(t("settings.planUpdated"));
      setBusyPlan(null);
      router.refresh();
    });
  }

  const busy = pending || redirecting;
  const renewsDate = renewsAt ? parseISO(renewsAt) : null;
  // Read once per render on the client; a renewal date is days apart, so a
  // render that straddles the instant it lapses is not worth a timer.
  // eslint-disable-next-line react-hooks/purity
  const lapsed = renewsDate !== null && renewsDate.getTime() <= Date.now();
  const paidAhead = renewsDate !== null && !lapsed;

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
              <p className="text-2xl font-extrabold">{currentName}</p>
              {discount > 0 && (
                <Badge variant="success">{discount}% off</Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {renewsDate
                ? lapsed
                  ? `Expired on ${format(renewsDate, "MMM d, yyyy")}`
                  : `Paid through ${format(renewsDate, "MMM d, yyyy")}`
                : "No active renewal date"}
            </p>
          </div>
          <CreditCard className="text-muted-foreground size-8" />
        </CardContent>
      </Card>

      {/*
        Monthly or yearly.
        Two buttons rather than a switch: a switch has to be read twice to work
        out which side is on, and this one decides what a church is charged.
      */}
      {annualFreeMonths > 0 && (
        <div className="flex flex-wrap items-center gap-3">
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
            Pay yearly · {freeMonthsLabel(annualFreeMonths)}
          </span>
        </div>
      )}

      {/* Plans */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p, i) => {
          const isCurrent = p.key === currentPlan;
          const monthlyPrice = prices[p.key];
          const price = annual ? annualPrices[p.key] : monthlyPrice;
          // A church abroad sees its own money; the naira total is explained
          // once below the grid rather than repeated on every card.
          const priceLabel =
            price === null
              ? "Custom"
              : price === 0
                ? "Free"
                : annual
                  ? (international?.annualLabels[p.key] ??
                    `₦${price.toLocaleString()}/yr`)
                  : (international?.labels[p.key] ??
                    `₦${price.toLocaleString()}/mo`);
          // What the year works out at per month, and what it saves. Said in
          // naira even for a church abroad: the conversion is on the price
          // above it, and two converted figures invite a comparison between
          // two rounded numbers that will not quite reconcile.
          const perMonth = monthlyEquivalent(monthlyPrice, annualFreeMonths);
          const saving = annualSaving(monthlyPrice, annualFreeMonths);
          const nairaWas = annual
            ? annualTotal(basePrices[p.key], annualFreeMonths)
            : basePrices[p.key];
          // Abroad: the converted "was" price, or nothing — never naira
          // beside a figure in another currency.
          const wasLabel = international
            ? ((annual ? international.annualBaseLabels : international.baseLabels)?.[p.key] ??
              null)
            : nairaWas !== null
              ? `₦${nairaWas.toLocaleString()}`
              : null;
          /*
           * The current plan can be paid for too: to renew early (the new
           * months start where the paid ones end), to switch a monthly plan
           * to a year, or simply to buy it during the trial. It used to be a
           * disabled "Current plan" button, so the only way to pay for the
           * plan a church was already on was to be locked out first.
           */
          /*
           * A plan with no price (Enterprise, or a custom plan marked
           * "contact us") is a conversation, not a checkout. Between two
           * tiers the words follow the tiers' order; a custom plan is not
           * above or below anything, so moving to or from one is a switch.
           */
          const action =
            basePrices[p.key] === null || basePrices[p.key] === undefined
              ? "contact"
              : // Every trial is on Pro (lib/trial.ts), so the cheaper tiers
                // are not a step down from anything the church chose.
                onTrial || trialExpired
                ? `Pay for ${p.name}`
                : isCurrent
                ? onTrial || !renewsDate
                  ? `Pay for ${p.name}`
                  : "Renew"
                : p.custom || !currentIsTier
                  ? "Switch"
                  : i > currentIndex
                    ? "Upgrade"
                    : "Downgrade";
          return (
            <div
              key={p.key}
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
                    {price !== null && price > 0 && discount > 0 && wasLabel && (
                      <span className="text-muted-foreground ml-1 text-xs font-normal line-through">
                        {/*
                          The undiscounted price for the SAME period, in the
                          SAME money. Striking through a monthly figure beside
                          a yearly one, or naira beside meticais, invited a
                          comparison between two different things.
                        */}
                        {wasLabel}
                      </span>
                    )}
                  </>
                )}
              </p>
              {annual && price !== null && price > 0 && perMonth !== null && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {international ? "In naira: works out at" : "Works out at"} ₦
                  {perMonth.toLocaleString()}/mo ·{" "}
                  <span className="text-primary font-semibold">
                    saves ₦{saving.toLocaleString()}
                  </span>
                </p>
              )}
              <ul className="mt-3 flex-1 space-y-1.5">
                {p.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs">
                    <Check className="text-primary mt-0.5 size-3.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {action === "contact" ? (
                <Button asChild variant="outline" className="mt-4 w-full">
                  <a href={`mailto:hello@flockinsight.com?subject=${encodeURIComponent(`${p.name} plan`)}`}>
                    Contact us
                  </a>
                </Button>
              ) : (
                <Button
                  className="mt-4 w-full"
                  variant={
                    action === "Upgrade" || (isCurrent && (onTrial || trialExpired || lapsed))
                      ? "default"
                      : "outline"
                  }
                  onClick={() => checkout(p.key)}
                  disabled={busy}
                >
                  {busy && busyPlan === p.key && (
                    <Loader2 className="animate-spin" />
                  )}
                  {action}
                  {annual ? " · 1 year" : ""}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/*
        What paying does to the time already bought, in one sentence each —
        the same rules lib/plan-period.ts applies on the server.
      */}
      {(paidAhead || onTrial) && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {onTrial
            ? "Paying now never shortens your free trial: the months you buy start when the trial ends. A plan smaller than Pro takes effect as soon as you pay for it."
            : "Renewing early adds the new months after the ones you have already paid for."}{" "}
          {paidAhead &&
            "Switching to a different plan carries over what is left of your current one at its value — a cheaper plan runs longer, a dearer one shorter — so nothing you paid for is lost."}
        </p>
      )}

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
          {annualFreeMonths > 0 &&
            " That fee is charged once per payment, so paying for the year carries it once rather than twelve times."}
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
                    {p.plan}{" "}
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
