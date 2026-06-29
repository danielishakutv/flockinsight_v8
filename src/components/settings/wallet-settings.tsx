"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { startWalletTopup } from "@/app/(app)/settings/wallet/actions";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Txn = {
  id: string;
  kind: "credit" | "debit";
  category: "topup" | "sms" | "storage" | "adjustment" | "refund";
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
};

const PRESETS = [500, 1000, 2000, 5000];

const CATEGORY_LABEL: Record<Txn["category"], string> = {
  topup: "Top-up",
  sms: "SMS",
  storage: "Storage",
  adjustment: "Adjustment",
  refund: "Refund",
};

export function WalletSettings({
  balance,
  currency,
  paymentsEnabled,
  payStatus,
  txns,
}: {
  balance: number;
  currency: string;
  paymentsEnabled: boolean;
  payStatus: string | null;
  txns: Txn[];
}) {
  const router = useRouter();
  const [topupOpen, setTopupOpen] = useState(false);
  const [amount, setAmount] = useState("1000");
  const [paying, setPaying] = useState(false);
  const toasted = useRef(false);

  useEffect(() => {
    if (toasted.current || !payStatus) return;
    toasted.current = true;
    if (payStatus === "success") toast.success("Wallet topped up!");
    else if (payStatus === "failed") toast.error("Payment failed or cancelled.");
    else if (payStatus === "error") toast.error("Something went wrong.");
    router.replace("/settings/wallet");
  }, [payStatus, router]);

  async function topUp() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 100)
      return toast.error("Minimum top-up is ₦100.");
    setPaying(true);
    const res = await startWalletTopup(amt);
    if (!res.ok) {
      toast.error(res.error);
      setPaying(false);
      return;
    }
    window.location.href = res.url; // to Paystack
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-primary/15 text-primary grid size-11 place-items-center rounded-xl">
              <Wallet className="size-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-semibold uppercase">
                Wallet balance
              </p>
              <p className="text-2xl font-extrabold tabular-nums">
                {formatMoney(balance, currency)}
              </p>
              <p className="text-muted-foreground text-xs">
                Funds SMS, storage upgrades & more.
              </p>
            </div>
          </div>
          <Button size="lg" onClick={() => setTopupOpen(true)}>
            <Plus className="size-5" />
            Top up
          </Button>
        </CardContent>
      </Card>

      {!paymentsEnabled && (
        <p className="text-muted-foreground text-sm">
          Online payments aren&apos;t configured yet. Contact support to top up
          your wallet.
        </p>
      )}

      {txns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Transaction history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {txns.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {t.reason ?? CATEGORY_LABEL[t.category]}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {CATEGORY_LABEL[t.category]} ·{" "}
                    {format(parseISO(t.createdAt), "MMM d, yyyy · h:mm a")}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={
                      "font-bold tabular-nums " +
                      (t.kind === "credit" ? "text-success" : "")
                    }
                  >
                    {t.kind === "credit" ? "+" : "−"}
                    {formatMoney(t.amount, currency)}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatMoney(t.balanceAfter, currency)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={topupOpen} onOpenChange={(o) => !paying && setTopupOpen(o)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Top up wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors " +
                    (Number(amount) === p
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent")
                  }
                >
                  ₦{p.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wtopup-amt">Amount (₦)</Label>
              <Input
                id="wtopup-amt"
                type="number"
                min={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Paid securely via Paystack.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTopupOpen(false)}
              disabled={paying}
            >
              Cancel
            </Button>
            <Button onClick={topUp} disabled={paying || !paymentsEnabled}>
              {paying && <Loader2 className="animate-spin" />}
              Pay with Paystack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
