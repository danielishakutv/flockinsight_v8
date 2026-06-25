"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startCheckout } from "@/app/(app)/settings/billing/actions";
import { PLANS, planName, type PlanId } from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  payments,
  status,
}: {
  currentPlan: string;
  renewsAt: string | null;
  discount: number;
  prices: Record<PlanId, number | null>;
  payments: PaymentRow[];
  status: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const toasted = useRef(false);

  useEffect(() => {
    if (toasted.current || !status) return;
    toasted.current = true;
    if (status === "success") toast.success("Payment successful — plan updated!");
    else if (status === "failed") toast.error("Payment failed or was cancelled.");
    else if (status === "error") toast.error("Something went wrong with that payment.");
    router.replace("/settings/billing");
  }, [status, router]);

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
      toast.success("Plan updated.");
      setBusyPlan(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
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
          const priceLabel =
            price === null ? "Custom" : price === 0 ? "Free" : `₦${price.toLocaleString()}/mo`;
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
                {isCurrent && <Badge>Current</Badge>}
              </div>
              <p className="mt-1 text-xl font-extrabold tracking-tight">
                {priceLabel}
                {price !== null && price > 0 && discount > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs font-normal line-through">
                    ₦{p.priceMonthly?.toLocaleString()}
                  </span>
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

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments yet.</p>
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
