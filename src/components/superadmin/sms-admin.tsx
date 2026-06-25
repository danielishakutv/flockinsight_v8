"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import {
  reviewSenderId,
  setSmsPrice,
  topUpSms,
} from "@/app/superadmin/sms/actions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
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

export type ChurchSms = {
  id: string;
  name: string;
  currency: string;
  senderId: string | null;
  status: "none" | "pending" | "approved" | "rejected";
  note: string | null;
  balance: number;
};

export function SmsAdmin({
  price,
  churches,
  gatewayReady,
}: {
  price: number;
  churches: ChurchSms[];
  gatewayReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [priceInput, setPriceInput] = useState(String(price));
  const [query, setQuery] = useState("");
  const [topUp, setTopUp] = useState<ChurchSms | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const applications = churches.filter((c) => c.status === "pending");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? churches.filter((c) => c.name.toLowerCase().includes(q)) : churches;
  }, [churches, query]);

  function savePrice() {
    const p = Number(priceInput);
    startTransition(async () => {
      const res = await setSmsPrice(p);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("SMS price updated");
      router.refresh();
    });
  }

  function review(c: ChurchSms, approve: boolean) {
    startTransition(async () => {
      const reason = approve
        ? undefined
        : prompt(`Reason for rejecting "${c.senderId}"? (optional)`) || "";
      const res = await reviewSenderId(c.id, approve, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(approve ? "Sender ID approved" : "Sender ID rejected");
      router.refresh();
    });
  }

  function doTopUp() {
    if (!topUp) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter an amount.");
    startTransition(async () => {
      const res = await topUpSms(topUp.id, amt, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Credited ${formatMoney(amt, topUp.currency)} to ${topUp.name}`);
      setTopUp(null);
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {!gatewayReady && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The SMS gateway isn&apos;t configured yet (set <code>KUDISMS_API_TOKEN</code>).
          Churches can apply for sender IDs, but sending won&apos;t work until it&apos;s set.
        </div>
      )}

      {/* Price */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SMS price (per page)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="price">Price charged to churches</Label>
              <Input
                id="price"
                type="number"
                min={0}
                step="0.5"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={savePrice} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save price
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Deducted from a church&apos;s wallet per SMS page (160 chars) × recipients.
          </p>
        </CardContent>
      </Card>

      {/* Pending applications */}
      {applications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Sender ID applications ({applications.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {applications.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.name} — <span className="font-mono">{c.senderId}</span>
                  </p>
                  {c.note && (
                    <p className="text-muted-foreground truncate text-xs">
                      {c.note}
                    </p>
                  )}
                </div>
                <Button size="sm" onClick={() => review(c, true)} disabled={pending}>
                  <Check className="size-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => review(c, false)}
                  disabled={pending}
                >
                  <X className="size-4" /> Reject
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All churches + wallets */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-lg">Church wallets</CardTitle>
          <div className="relative w-48">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="h-9 pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{c.name}</p>
                  {c.status === "approved" && (
                    <Badge variant="success">{c.senderId}</Badge>
                  )}
                  {c.status === "pending" && <Badge variant="secondary">Pending</Badge>}
                  {c.status === "rejected" && (
                    <Badge variant="destructive">Rejected</Badge>
                  )}
                </div>
              </div>
              <p className="font-bold tabular-nums">
                {formatMoney(c.balance, c.currency)}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTopUp(c);
                  setAmount("");
                  setNote("");
                }}
              >
                <Wallet className="size-4" /> Top up
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={topUp !== null} onOpenChange={(o) => !o && setTopUp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top up {topUp?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="amt">Amount ({topUp?.currency})</Label>
              <Input
                id="amt"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amt-note">Note (optional)</Label>
              <Input
                id="amt-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Paid via transfer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopUp(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={doTopUp} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Credit wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
