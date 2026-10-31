"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addIncome, voidIncome } from "@/app/superadmin/finance/profit/actions";
import type { IncomeView } from "@/lib/cost-to-serve";
import { INCOME_CATEGORIES, incomeDef, type CostReport } from "@/lib/cost-to-serve-shared";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableTable } from "@/components/ui/scrollable-table";

const today = () => new Date().toISOString().slice(0, 10);

export function IncomeEntries({
  entries,
  revenue,
  churches,
  canManage,
}: {
  entries: IncomeView[];
  revenue: CostReport["revenue"];
  churches: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<IncomeView | null>(null);
  const [reason, setReason] = useState("");

  const [receivedOn, setReceivedOn] = useState(today());
  const [category, setCategory] = useState("donation");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [amountNgn, setAmountNgn] = useState("");
  const [source, setSource] = useState("");
  const [churchId, setChurchId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const def = incomeDef(category);

  function reset() {
    setReceivedOn(today());
    setCategory("donation");
    setAmount("");
    setCurrency("NGN");
    setAmountNgn("");
    setSource("");
    setChurchId("");
    setReference("");
    setDescription("");
  }

  function save() {
    start(async () => {
      const res = await addIncome({
        receivedOn,
        category,
        amount: Number(amount),
        currency,
        amountNgn: currency === "USD" && amountNgn ? Number(amountNgn) : null,
        source,
        churchId: churchId || null,
        reference,
        description,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Income recorded.");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  function doVoid() {
    if (!voiding) return;
    start(async () => {
      const res = await voidIncome({ id: voiding.id, reason });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Voided.");
      setVoiding(null);
      setReason("");
      router.refresh();
    });
  }

  const auto = [
    { label: "Plan payments", amount: revenue.subscriptions, note: "From Finance: card payments and every transfer recorded there, spread over the months they pay for." },
    { label: "SMS bought from wallets", amount: revenue.walletSms, note: "What churches spent on SMS, less refunds. A top-up is not revenue until it is spent." },
    { label: "Storage bought from wallets", amount: revenue.walletStorage, note: "Storage add-ons paid from the wallet." },
  ];

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-2xl border">
        <div className="p-4">
          <p className="text-sm font-bold">Counted for you</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            A church that paid for a plan in cash or by transfer belongs on{" "}
            <Link href="/superadmin/finance" className="text-primary underline-offset-2 hover:underline">
              Finance → Record a payment
            </Link>
            , not here: that moves their plan, counts in their row, and pays any Partner.
          </p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {auto.map((a) => (
              <tr key={a.label} className="border-t">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-muted-foreground text-xs">{a.note}</p>
                </td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-card rounded-2xl border">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-bold">Entered by hand</p>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs">
              Donations, grants, training fees, a church paying for credit you added by hand. A loan or an investment is recorded as cash
              in, and never counted as profit.
            </p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Record income
            </Button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-muted-foreground border-t p-6 text-center text-sm">Nothing entered in this period.</p>
        ) : (
          <ScrollableTable>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted-foreground border-y text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Received</th>
                  <th className="px-3 py-2 text-left font-medium">What</th>
                  <th className="px-3 py-2 text-left font-medium">From</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap">{e.receivedOn}</td>
                    <td className="px-3 py-2.5">
                      <p>
                        {incomeDef(e.category).label}
                        {!incomeDef(e.category).profit && <Badge variant="secondary" className="ml-2">Not profit</Badge>}
                      </p>
                      {e.description && <p className="text-muted-foreground text-xs">{e.description}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{e.churchName ?? e.source ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <p className="font-medium">{formatMoney(e.amountNgn)}</p>
                      {e.currency !== "NGN" && <p className="text-muted-foreground text-xs">${e.amount.toLocaleString()}</p>}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setVoiding(e)}>
                          Void
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </section>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record income</DialogTitle>
            <DialogDescription>Money that came in other than a plan payment.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="in-cat">What it was</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="in-cat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCOME_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {def.needsChurch || churchId ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="in-church">Church</Label>
                <Select value={churchId} onValueChange={setChurchId}>
                  <SelectTrigger id="in-church">
                    <SelectValue placeholder="Pick the church that paid" />
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
            ) : (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="in-source">From</Label>
                <Input id="in-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Who gave it" maxLength={120} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="in-amount">Amount</Label>
              <div className="flex gap-2">
                <Select value={currency} onValueChange={(v) => setCurrency(v as "NGN" | "USD")}>
                  <SelectTrigger className="w-20" aria-label="Currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">₦</SelectItem>
                    <SelectItem value="USD">$</SelectItem>
                  </SelectContent>
                </Select>
                <Input id="in-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="in-date">Received on</Label>
              <Input id="in-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
            {currency === "USD" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="in-ngn">Naira that landed</Label>
                <Input
                  id="in-ngn"
                  inputMode="decimal"
                  value={amountNgn}
                  onChange={(e) => setAmountNgn(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="From your bank statement. Blank: today's rate"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="in-ref">Reference</Label>
              <Input id="in-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="in-desc">Note</Label>
              <Input id="in-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" maxLength={300} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !(Number(amount) > 0) || (def.needsChurch && !churchId)}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void this income</DialogTitle>
            <DialogDescription>
              {voiding ? `${formatMoney(voiding.amountNgn)} on ${voiding.receivedOn} leaves every figure. It stays on record with your reason.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="in-void">Why</Label>
            <Input id="in-void" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered twice" maxLength={200} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doVoid} disabled={pending || !reason.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
