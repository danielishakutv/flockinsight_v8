"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarClock, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  setPaymentWaived,
  extendTrial,
} from "@/app/superadmin/churches/[id]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export function ChurchTrialControls({
  churchId,
  paymentWaived,
  trialEndsAt,
  standingLabel,
}: {
  churchId: string;
  paymentWaived: boolean;
  trialEndsAt: string | null;
  standingLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggleWaive(next: boolean) {
    start(async () => {
      const res = await setPaymentWaived(churchId, next);
      if (res.ok) {
        toast.success(next ? "Payment waived — this church is comped." : "Waiver removed.");
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <p className="text-sm font-semibold">Waive payment (comp this church)</p>
            <p className="text-muted-foreground text-xs">
              When on, the church never needs to pay to use the app. Current
              standing: <span className="font-medium">{standingLabel}</span>.
            </p>
          </div>
          <Switch
            checked={paymentWaived}
            onCheckedChange={toggleWaive}
            disabled={pending}
          />
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
