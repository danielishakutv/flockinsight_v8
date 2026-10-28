"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { recordOfflinePayment } from "@/app/superadmin/finance/actions";
import type { PlanOption } from "@/lib/plan-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Log money that arrived by transfer, cash or POS.
 *
 * Most churches here pay into a bank account, so without this the ledger only
 * ever knew about card payments — and "set the plan" wrote a zero-naira row,
 * which moved the plan without moving the revenue.
 */
export function RecordPayment({
  churches,
  planOptions,
}: {
  /** `planKey` is the church's plan now, so picking a church picks its plan. */
  churches: { id: string; name: string; planKey: string }[];
  planOptions: PlanOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [churchId, setChurchId] = useState("");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState("growth");
  const [months, setMonths] = useState("1");
  const [extendPlan, setExtendPlan] = useState(true);
  const [gateway, setGateway] = useState("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  function reset() {
    setChurchId("");
    setAmount("");
    setPlan("growth");
    setMonths("1");
    setExtendPlan(true);
    setGateway("transfer");
    setReference("");
    setNote("");
    setPaidOn(new Date().toISOString().slice(0, 10));
  }

  const monthsN = Math.round(Number(months));
  const monthsOk = Number.isFinite(monthsN) && monthsN >= 1 && monthsN <= 36;

  function submit() {
    if (!monthsOk) {
      toast.error("Enter the months this payment covers (1 to 36).");
      return;
    }
    start(async () => {
      const res = await recordOfflinePayment({
        churchId,
        amount: Number(amount),
        plan,
        months: monthsN,
        extendPlan,
        gateway: gateway as "transfer",
        reference,
        note,
        paidOn,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Payment recorded.");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Record a payment
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              For money that came in outside the payment gateway — a transfer,
              cash, or POS.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rp-church">Church</Label>
              <Select
                value={churchId}
                onValueChange={(id) => {
                  setChurchId(id);
                  /*
                   * Their own plan, by default. A transfer from a church on a
                   * custom plan recorded against "Growth" would otherwise move
                   * it off the plan it pays for, quietly.
                   */
                  const key = churches.find((c) => c.id === id)?.planKey;
                  if (key && planOptions.some((p) => p.key === key)) setPlan(key);
                }}
              >
                <SelectTrigger id="rp-church">
                  <SelectValue placeholder="Choose a church" />
                </SelectTrigger>
                <SelectContent>
                  {churches.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-amount">Amount received (₦)</Label>
              <Input
                id="rp-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25000"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-paid">Date paid</Label>
              <Input
                id="rp-paid"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-plan">Plan</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger id="rp-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {planOptions.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-months">Months covered</Label>
              <Input
                id="rp-months"
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-gateway">How it came in</Label>
              <Select value={gateway} onValueChange={setGateway}>
                <SelectTrigger id="rp-gateway">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                  <SelectItem value="paystack">Paystack</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-ref">Reference (optional)</Label>
              <Input
                id="rp-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Teller or transfer ref"
              />
            </div>

            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={extendPlan}
                onChange={(e) => setExtendPlan(e.target.checked)}
              />
              <span>Also extend their plan by these months</span>
            </label>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rp-note">Note (optional)</Label>
              <Input
                id="rp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Paid at the pastors' conference"
              />
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            Months covered is how much subscription this money pays for — it is
            what the Partner&apos;s commission is priced across, so a year paid at
            once is 12, never 1. With &ldquo;extend&rdquo; ticked the plan is
            extended from their current renewal date, or today if that has
            passed. Untick it if the plan was already set by hand.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !churchId || !(Number(amount) > 0) || !monthsOk}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
