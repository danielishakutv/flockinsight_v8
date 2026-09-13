"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { recordOfflinePayment } from "@/app/superadmin/finance/actions";
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
}: {
  churches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [churchId, setChurchId] = useState("");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState("growth");
  const [months, setMonths] = useState("1");
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
    setGateway("transfer");
    setReference("");
    setNote("");
    setPaidOn(new Date().toISOString().slice(0, 10));
  }

  function submit() {
    start(async () => {
      const res = await recordOfflinePayment({
        churchId,
        amount: Number(amount),
        plan: plan as "growth",
        months: Number(months) || 0,
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
              <Select value={churchId} onValueChange={setChurchId}>
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
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-months">Months covered</Label>
              <Input
                id="rp-months"
                type="number"
                min={0}
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
            Months covered extends their plan from today, or from their current
            renewal date if it is still ahead. Set it to 0 to log the money
            without touching the plan.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !churchId || !(Number(amount) > 0)}
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
