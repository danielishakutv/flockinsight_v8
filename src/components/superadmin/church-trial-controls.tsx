"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarClock, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  setPaymentWaived,
  extendTrial,
} from "@/app/superadmin/churches/[id]/actions";
import { WAIVER_DURATIONS } from "@/lib/trial";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ChurchTrialControls({
  churchId,
  paymentWaived,
  waiverEndsAt,
  waiverLapsed,
  trialEndsAt,
  standingLabel,
}: {
  churchId: string;
  paymentWaived: boolean;
  /** The stored deadline, whether or not it has passed. Null = no end date. */
  waiverEndsAt: string | null;
  /** Waiver flag is on but its deadline has been and gone. */
  waiverLapsed: boolean;
  trialEndsAt: string | null;
  standingLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Default to six months rather than "no end date": a comp that quietly never
  // ends is how a paying church stops being one.
  const [months, setMonths] = useState("6");

  const active = paymentWaived && !waiverLapsed;

  function grant() {
    const m = Number(months);
    start(async () => {
      const res = await setPaymentWaived(churchId, true, m);
      if (res.ok) {
        toast.success(
          m > 0
            ? `Comped for ${WAIVER_DURATIONS.find((d) => d.months === m)?.label ?? `${m} months`}.`
            : "Comped with no end date.",
        );
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function revoke() {
    start(async () => {
      const res = await setPaymentWaived(churchId, false);
      if (res.ok) {
        toast.success("Waiver removed.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function extend(weeks: number) {
    start(async () => {
      const res = await extendTrial(churchId, weeks);
      if (res.ok) {
        toast.success(`Trial extended by ${weeks} week${weeks === 1 ? "" : "s"}.`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gift className="text-primary size-5" /> Trial &amp; comp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border p-3">
          <p className="text-sm font-semibold">Waive payment (comp this church)</p>
          <p className="text-muted-foreground mt-1 text-xs">
            While it runs, the church is never asked to pay and is never blocked
            when a trial ends. Current standing:{" "}
            <span className="font-medium">{standingLabel}</span>.
          </p>

          {active && (
            <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {waiverEndsAt
                ? `Comped until ${format(parseISO(waiverEndsAt), "d MMM yyyy")}.`
                : "Comped with no end date."}
            </p>
          )}
          {/*
            A lapsed comp is said out loud. Otherwise the only visible change is
            the church suddenly being asked to pay, and nobody here would know why.
          */}
          {paymentWaived && waiverLapsed && waiverEndsAt && (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              The comp ended on {format(parseISO(waiverEndsAt), "d MMM yyyy")} —
              this church is back on the normal billing rules.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={months} onValueChange={setMonths} disabled={pending}>
              <SelectTrigger className="w-40" aria-label="How long">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAIVER_DURATIONS.map((d) => (
                  <SelectItem key={d.months} value={String(d.months)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={grant} disabled={pending} size="sm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {active ? "Change the comp" : "Comp this church"}
            </Button>
            {paymentWaived && (
              <Button
                onClick={revoke}
                disabled={pending}
                size="sm"
                variant="outline"
              >
                Remove waiver
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border p-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="text-muted-foreground size-4" />
            <p className="text-sm font-semibold">
              Free trial{" "}
              {trialEndsAt ? (
                <span className="text-muted-foreground font-normal">
                  ends {format(parseISO(trialEndsAt), "MMM d, yyyy")}
                </span>
              ) : (
                <span className="text-muted-foreground font-normal">not set (grandfathered)</span>
              )}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[1, 2, 4].map((w) => (
              <Button
                key={w}
                variant="outline"
                size="sm"
                onClick={() => extend(w)}
                disabled={pending}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                +{w} week{w === 1 ? "" : "s"}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
