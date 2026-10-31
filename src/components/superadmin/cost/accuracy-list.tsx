"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchPaystackFees, setDollarRate } from "@/app/superadmin/finance/profit/actions";
import type { Check } from "@/lib/cost-insights-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ICON = {
  ok: <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Fine" />,
  warn: <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-label="Needs a look" />,
  missing: <CircleDashed className="size-4 text-red-600 dark:text-red-400" aria-label="Missing" />,
};

/**
 * Every way the figures on this page can be wrong that the platform can
 * detect, each with its fix. Problems first.
 */
export function AccuracyList({ checks, canManage, ngnPerUsd, ownRate }: { checks: Check[]; canManage: boolean; ngnPerUsd: number; ownRate: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rateOpen, setRateOpen] = useState(false);
  const [rate, setRate] = useState(ownRate ? String(Math.round(ngnPerUsd)) : "");
  const order = { missing: 0, warn: 1, ok: 2 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);

  function fetchFees() {
    start(async () => {
      const res = await fetchPaystackFees();
      if (res.ok) toast.success(res.message ?? "Done.");
      else toast.error(res.error);
      router.refresh();
    });
  }

  function saveRate(clear: boolean) {
    start(async () => {
      const res = await setDollarRate({ ngnPerUsd: clear ? null : Number(rate) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(clear ? "Back to the market rate." : "Rate saved.");
      setRateOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="bg-card rounded-2xl border">
      <div className="p-4">
        <p className="text-sm font-bold">How far to trust these figures</p>
        <p className="text-muted-foreground mt-0.5 max-w-3xl text-xs">
          The report is only as accurate as its weakest input. Each line is something the platform checked; fix the amber and red
          ones and the figures above become exact rather than estimated.
        </p>
      </div>
      <ul>
        {sorted.map((c) => (
          <li key={c.key} className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-start">
            <span className="mt-0.5 shrink-0">{ICON[c.status]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.title}</p>
              <p className="text-muted-foreground text-xs">{c.detail}</p>
            </div>
            {c.fix &&
              // An in-page tab is a plain anchor: the tabs follow hashchange, which a Link never fires.
              (c.fix.href ? (
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  {c.fix.href.startsWith("#") ? <a href={c.fix.href}>{c.fix.label}</a> : <Link href={c.fix.href}>{c.fix.label}</Link>}
                </Button>
              ) : canManage && c.fix.action === "fetch-fees" ? (
                <Button size="sm" variant="outline" className="shrink-0" onClick={fetchFees} disabled={pending}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {c.fix.label}
                </Button>
              ) : canManage && c.fix.action === "set-rate" ? (
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => setRateOpen(true)}>
                  {c.fix.label}
                </Button>
              ) : null)}
          </li>
        ))}
      </ul>

      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What a dollar costs you</DialogTitle>
            <DialogDescription>
              Take a dollar charge from your bank statement and divide the naira debited by the dollars. That includes the bank&apos;s
              spread and card fees, which the market rate does not.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="fx-rate">Naira per dollar</Label>
            <Input id="fx-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder="1650" />
          </div>
          <DialogFooter className="gap-2">
            {ownRate && (
              <Button variant="ghost" onClick={() => saveRate(true)} disabled={pending}>
                Use the market rate
              </Button>
            )}
            <Button onClick={() => saveRate(false)} disabled={pending || !(Number(rate) >= 100)}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
