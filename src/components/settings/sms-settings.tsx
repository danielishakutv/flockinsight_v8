"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Plus,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  applySenderId,
  checkSenderIdStatus,
  startSmsTopup,
} from "@/app/(app)/settings/sms/actions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
};

const PRESETS = [500, 1000, 2000, 5000];

export function SmsSettings({
  senderId,
  status,
  note,
  balance,
  currency,
  price,
  payStatus,
  txns,
}: {
  senderId: string | null;
  status: "none" | "pending" | "approved" | "rejected";
  note: string | null;
  balance: number;
  currency: string;
  price: number;
  payStatus: string | null;
  txns: Txn[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sid, setSid] = useState(senderId ?? "");
  const [reason, setReason] = useState("");
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
    router.replace("/settings/sms");
  }, [payStatus, router]);

  async function topUp() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 100)
      return toast.error("Minimum top-up is ₦100.");
    setPaying(true);
    const res = await startSmsTopup(amt);
    if (!res.ok) {
      toast.error(res.error);
      setPaying(false);
      return;
    }
    window.location.href = res.url; // to Paystack
  }

  function apply() {
    startTransition(async () => {
      const res = await applySenderId(sid, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sender ID submitted to Termii for review.");
      router.refresh();
    });
  }

  function checkStatus() {
    startTransition(async () => {
      const res = await checkSenderIdStatus();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.status === "approved") toast.success("Approved! You can send SMS now.");
      else if (res.status === "rejected") toast.error("This sender ID was rejected.");
      else toast.message("Still under review — please check again later.");
      router.refresh();
    });
  }

  const showForm = status === "none" || status === "rejected";

  return (
    <div className="space-y-4">
      {/* Balance */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-primary/15 text-primary grid size-11 place-items-center rounded-xl">
              <Wallet className="size-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-semibold uppercase">
                SMS balance
              </p>
              <p className="text-2xl font-extrabold tabular-nums">
                {formatMoney(balance, currency)}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatMoney(price, currency)} per SMS page
              </p>
            </div>
          </div>
          <Button size="lg" onClick={() => setTopupOpen(true)}>
            <Plus className="size-5" />
            Top up wallet
          </Button>
        </CardContent>
      </Card>

      {/* Sender ID */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="text-primary size-5" /> Sender ID
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "pending" && (
            <div className="flex items-start gap-3 rounded-xl border p-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="font-semibold">
                  “{senderId}” is under review{" "}
                  <Badge variant="secondary">Pending</Badge>
                </p>
                <p className="text-muted-foreground text-sm">
                  Termii is reviewing your sender ID. Approval usually takes a few
                  hours. Check the latest status below.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={checkStatus}
                  disabled={pending}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  Check approval status
                </Button>
              </div>
            </div>
          )}

          {status === "approved" && (
            <div className="flex items-start gap-3 rounded-xl border p-3">
              <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  “{senderId}” approved{" "}
                  <Badge variant="success">Approved</Badge>
                </p>
                <p className="text-muted-foreground text-sm">
                  Your messages will be sent from this sender ID.
                </p>
              </div>
            </div>
          )}

          {status === "rejected" && (
            <div className="flex items-start gap-3 rounded-xl border p-3">
              <XCircle className="text-destructive mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  Application rejected{" "}
                  <Badge variant="destructive">Rejected</Badge>
                </p>
                {note && (
                  <p className="text-muted-foreground text-sm">Reason: {note}</p>
                )}
                <p className="text-muted-foreground text-sm">
                  Please adjust and re-apply below.
                </p>
              </div>
            </div>
          )}

          {showForm && (
            <>
              <div className="space-y-2">
                <Label htmlFor="sid">Requested sender ID</Label>
                <Input
                  id="sid"
                  value={sid}
                  onChange={(e) => setSid(e.target.value)}
                  placeholder="e.g. GraceChapel"
                  maxLength={11}
                />
                <p className="text-muted-foreground text-xs">
                  3–11 letters or numbers, no spaces or symbols. This is what
                  recipients see as the sender.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sid-note">
                  What will you use it for? (optional)
                </Label>
                <Textarea
                  id="sid-note"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Service reminders and announcements to our members."
                  rows={2}
                />
              </div>
              <Button onClick={apply} disabled={pending || !sid.trim()}>
                {pending && <Loader2 className="animate-spin" />}
                Submit for approval
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ledger */}
      {txns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Wallet history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {txns.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {t.reason ?? (t.kind === "credit" ? "Top-up" : "SMS")}
                  </p>
                  <p className="text-muted-foreground text-xs">
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
            <DialogTitle>Top up SMS wallet</DialogTitle>
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
              <Label htmlFor="topup-amt">Amount (₦)</Label>
              <Input
                id="topup-amt"
                type="number"
                min={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                ≈ {Math.floor(Number(amount) / (price || 1)).toLocaleString()} SMS
                pages at {formatMoney(price, currency)} each. Paid securely via
                Paystack.
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
            <Button onClick={topUp} disabled={paying}>
              {paying && <Loader2 className="animate-spin" />}
              Pay with Paystack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
