"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Loader2, Pencil, RefreshCw, Search, Send, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import {
  adjustWallet,
  checkSenderIdOnNetwork,
  reviewSenderId,
  revokeSenderId,
  sendTestSms,
  setSenderId,
  setSmsPrice,
  submitSenderIdToTermii,
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
  status: "none" | "pending" | "approved" | "rejected" | "revoked";
  stage: string | null;
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
  const [kind, setKind] = useState<"credit" | "debit">("credit");
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("");

  function sendTest() {
    if (!testTo.trim()) return toast.error("Enter a phone number.");
    startTransition(async () => {
      const res = await sendTestSms(testTo.trim(), testMsg);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Test SMS sent!");
    });
  }

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

  function editId(c: ChurchSms) {
    const next = prompt(`Sender ID for ${c.name} (3–11 letters/numbers)`, c.senderId ?? "");
    if (next === null) return;
    startTransition(async () => {
      const res = await setSenderId(c.id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sender ID updated");
      router.refresh();
    });
  }

  function revoke(c: ChurchSms) {
    const reason =
      prompt(`Revoke "${c.senderId}" for ${c.name}? Reason (shown to them, optional):`) ??
      null;
    if (reason === null) return;
    startTransition(async () => {
      const res = await revokeSenderId(c.id, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sender ID revoked");
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

  function submit(c: ChurchSms) {
    startTransition(async () => {
      const res = await submitSenderIdToTermii(c.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  function checkNetwork(c: ChurchSms) {
    startTransition(async () => {
      const res = await checkSenderIdOnNetwork(c.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.status === "approved") toast.success("Approved by the network!");
      else if (res.status === "rejected") toast.error("Rejected by the network.");
      else toast.message("Still processing — check again later.");
      router.refresh();
    });
  }

  function doTopUp() {
    if (!topUp) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter an amount.");
    startTransition(async () => {
      const res = await adjustWallet(topUp.id, amt, kind, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${kind === "credit" ? "Credited" : "Deducted"} ${formatMoney(amt, topUp.currency)} ${kind === "credit" ? "to" : "from"} ${topUp.name}`,
      );
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
          The SMS gateway isn&apos;t configured yet (set <code>TERMII_API_KEY</code>{" "}
          and <code>TERMII_SENDER_ID</code>). Churches can apply for sender IDs,
          but sending won&apos;t work until it&apos;s set.
        </div>
      )}

      {/* Send a test SMS via the platform sender ID (TEDxYola) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Send a test SMS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="test-to">Phone number</Label>
              <Input
                id="test-to"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="08012345678"
                className="w-48"
              />
            </div>
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label htmlFor="test-msg">Message (optional)</Label>
              <Input
                id="test-msg"
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                placeholder="FlockInsight test SMS — it works!"
              />
            </div>
            <Button onClick={sendTest} disabled={pending || !gatewayReady}>
              {pending && <Loader2 className="animate-spin" />}
              Send test
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Sends from your platform sender ID (<code>TERMII_SENDER_ID</code>).
          </p>
        </CardContent>
      </Card>

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
            {applications.map((c) => {
              const submitted = c.stage === "submitted";
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {c.name} — <span className="font-mono">{c.senderId}</span>
                      <Badge variant="secondary">
                        {submitted ? "Processing" : "Awaiting review"}
                      </Badge>
                    </p>
                    {c.note && (
                      <p className="text-muted-foreground truncate text-xs">{c.note}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => editId(c)}
                    disabled={pending}
                  >
                    <Pencil className="size-4" /> Edit ID
                  </Button>
                  {!submitted && (
                    <Button size="sm" onClick={() => submit(c)} disabled={pending}>
                      <Send className="size-4" /> Submit to network
                    </Button>
                  )}
                  {submitted && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => checkNetwork(c)}
                        disabled={pending}
                      >
                        <RefreshCw className="size-4" /> Check status
                      </Button>
                      <Button size="sm" onClick={() => review(c, true)} disabled={pending}>
                        <Check className="size-4" /> Mark approved
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => review(c, false)}
                    disabled={pending}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              );
            })}
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
                  {c.status === "pending" && (
                    <Badge variant="secondary">
                      {c.stage === "submitted" ? "Processing" : "Awaiting review"}
                    </Badge>
                  )}
                  {c.status === "rejected" && (
                    <Badge variant="destructive">Rejected</Badge>
                  )}
                  {c.status === "revoked" && (
                    <Badge variant="destructive">Revoked</Badge>
                  )}
                </div>
              </div>
              <p className="font-bold tabular-nums">
                {formatMoney(c.balance, c.currency)}
              </p>
              {c.status === "approved" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => revoke(c)}
                  disabled={pending}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Ban className="size-4" /> Revoke
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => editId(c)}
                aria-label="Edit sender ID"
              >
                <Pencil className="size-4" /> ID
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTopUp(c);
                  setAmount("");
                  setNote("");
                  setKind("credit");
                }}
              >
                <Wallet className="size-4" /> Adjust
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={topUp !== null} onOpenChange={(o) => !o && setTopUp(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Adjust {topUp?.name}&apos;s wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setKind("credit")}
                className={
                  "rounded-md py-1.5 text-sm font-semibold transition-colors " +
                  (kind === "credit"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground")
                }
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setKind("debit")}
                className={
                  "rounded-md py-1.5 text-sm font-semibold transition-colors " +
                  (kind === "debit"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground")
                }
              >
                Deduct
              </button>
            </div>
            {topUp && (
              <p className="text-muted-foreground text-xs">
                Current balance: {formatMoney(topUp.balance, topUp.currency)}
              </p>
            )}
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
                placeholder={
                  kind === "credit" ? "e.g. Paid via transfer" : "e.g. Refund / correction"
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopUp(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={doTopUp}
              disabled={pending}
              variant={kind === "debit" ? "destructive" : "default"}
            >
              {pending && <Loader2 className="animate-spin" />}
              {kind === "credit" ? "Credit wallet" : "Deduct from wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
