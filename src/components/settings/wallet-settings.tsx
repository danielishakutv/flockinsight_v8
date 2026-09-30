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
import { useT } from "@/components/i18n-provider";

type Txn = {
  id: string;
  kind: "credit" | "debit";
  category: "topup" | "sms" | "storage" | "advance" | "adjustment" | "refund";
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
  // Named plainly on the church's own statement: they are being told they
  // owe it, so "advance" is clearer than an accounting word.
  advance: "Advance from FlockInsight",
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
  const t = useT();
  const router = useRouter();
  const [topupOpen, setTopupOpen] = useState(false);
  const [amount, setAmount] = useState("1000");
  const [paying, setPaying] = useState(false);
  const toasted = useRef(false);

  useEffect(() => {
    if (toasted.current || !payStatus) return;
    toasted.current = true;
    if (payStatus === "success") toast.success(t("settings.walletToppedUp"));
    else if (payStatus === "failed") toast.error(t("settings.paymentFailedOrCancelled"));
    else if (payStatus === "error") toast.error(t("settings.somethingWentWrong"));
    router.replace("/settings/wallet");
  }, [payStatus, router, t]);

  async function topUp() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 100)
      return toast.error(t("settings.minimumTopUpIs100"));
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
                {balance < 0 ? "Balance owing" : "Wallet balance"}
              </p>
              {/*
                A negative balance is an advance we extended, not a glitch. Say
                so in words — "-₦5,000" on its own reads as a broken figure.
              */}
              <p
                className={`text-2xl font-extrabold tabular-nums ${
                  balance < 0 ? "text-amber-600 dark:text-amber-400" : ""
                }`}
              >
                {formatMoney(Math.abs(balance), currency)}
              </p>
              <p className="text-muted-foreground text-xs">
                {balance < 0
                  ? "You owe this. Your next top-up clears it first."
                  : "Funds SMS, storage upgrades & more."}
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
            <CardTitle className="text-lg">{t("settings.transactionHistory")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {txns.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {txn.reason ?? CATEGORY_LABEL[txn.category]}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {CATEGORY_LABEL[txn.category]} ·{" "}
                    {format(parseISO(txn.createdAt), "MMM d, yyyy · h:mm a")}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={
                      "font-bold tabular-nums " +
                      (txn.kind === "credit" ? "text-success" : "")
                    }
                  >
                    {txn.kind === "credit" ? "+" : "−"}
                    {formatMoney(txn.amount, currency)}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatMoney(txn.balanceAfter, currency)}
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
            <DialogTitle>{t("settings.topUpWallet")}</DialogTitle>
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
              <Label htmlFor="wtopup-amt">{t("settings.amount")}</Label>
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
