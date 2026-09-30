"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  resetPlanCopyAction,
  setPlanAllowancesAction,
} from "@/app/superadmin/pricing/actions";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ALL_PLANS: PlanId[] = ["starter", "growth", "pro", "enterprise"];

/**
 * What each plan INCLUDES, as opposed to what it costs.
 *
 * Kept apart from the price panel deliberately. These two numbers are the ones
 * the supplier bill is actually made of — Cloudinary charges by the gigabyte
 * stored and steps to $99 a month past 25 of them, ZeptoMail charges per ten
 * thousand emails sent with no tier to fall off — so they move for entirely
 * different reasons than a price does. An operator changing storage is
 * answering Cloudinary; one changing a price is answering the market.
 *
 * Storage is entered in megabytes because that is the unit the decision is
 * made in. Nobody reasons about 524,288,000.
 */
export function PlanAllowances({
  storageMb,
  emails,
  overridden,
}: {
  storageMb: Record<PlanId, number>;
  emails: Record<PlanId, number | null>;
  /** Whether this plan's public copy is a saved override rather than the default. */
  overridden: Record<PlanId, boolean>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<PlanId | null>(null);

  const [storage, setStorage] = useState<Record<string, string>>(
    Object.fromEntries(ALL_PLANS.map((p) => [p, String(storageMb[p] ?? 0)])),
  );
  const [mail, setMail] = useState<Record<string, string>>(
    Object.fromEntries(
      ALL_PLANS.map((p) => [p, emails[p] === null ? "" : String(emails[p])]),
    ),
  );

  const reset = (plan: PlanId) =>
    start(async () => {
      setBusy(plan);
      const res = await resetPlanCopyAction(plan);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${PLAN_BY_ID[plan].name} back to the built-in defaults.`);
      router.refresh();
    });

  const save = (plan: PlanId) =>
    start(async () => {
      setBusy(plan);
      const res = await setPlanAllowancesAction({
        plan,
        storageMb: Number(storage[plan] || 0),
        emails: mail[plan] ?? "",
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${PLAN_BY_ID[plan].name} allowances saved.`);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">What each plan includes</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          These are the numbers the supplier bill is made of. Storage steps in
          price — roughly a credit per gigabyte a month, with a jump to $99
          once the free 25 are gone — so it is the one to be careful with.
          Email is pay-as-you-go at ten thousand a credit, so it is the one you
          can afford to be generous with. Leave emails blank for unlimited.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {ALL_PLANS.map((plan) => (
          <div
            key={plan}
            className="grid grid-cols-1 items-end gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div className="space-y-1.5">
              <Label htmlFor={`st-${plan}`} className="text-xs">
                {PLAN_BY_ID[plan].name} — storage (MB)
              </Label>
              <Input
                id={`st-${plan}`}
                inputMode="numeric"
                value={storage[plan] ?? ""}
                onChange={(e) =>
                  setStorage((s) => ({ ...s, [plan]: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`em-${plan}`} className="text-xs">
                Emails / month
              </Label>
              <Input
                id={`em-${plan}`}
                inputMode="numeric"
                placeholder="blank = unlimited"
                value={mail[plan] ?? ""}
                onChange={(e) => setMail((s) => ({ ...s, [plan]: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => save(plan)}
              >
                {busy === plan && <Loader2 className="animate-spin" />}
                Save
              </Button>
              {overridden[plan] && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => reset(plan)}
                  title="Drop the saved copy and use the built-in defaults"
                >
                  Reset
                </Button>
              )}
            </div>

            {overridden[plan] && (
              <p className="text-muted-foreground text-xs leading-relaxed sm:col-span-3">
                This plan is showing <strong>saved copy</strong>, not the
                built-in defaults — so changes shipped in a release will not
                appear on the pricing page until you reset it or edit it here.
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
