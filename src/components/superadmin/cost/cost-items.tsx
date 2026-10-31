"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { archiveCostItem, changeCostPrice, endCostItem, saveCostItem } from "@/app/superadmin/finance/profit/actions";
import type { CostItemView } from "@/lib/cost-to-serve";
import {
  BUCKET_LABEL,
  CHANNEL_SUGGESTIONS,
  COST_CATEGORIES,
  COST_DRIVERS,
  DRIVER_LABEL,
  FREQUENCY_LABEL,
  FREQUENCIES,
  categoryDef,
  monthlyEquivalent,
  type CostDriver,
  type CostLine,
  type Frequency,
} from "@/lib/cost-to-serve-shared";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableTable } from "@/components/ui/scrollable-table";

const today = () => new Date().toISOString().slice(0, 10);

type Form = {
  id?: string;
  name: string;
  vendor: string;
  category: string;
  amount: string;
  currency: "NGN" | "USD";
  frequency: Frequency;
  startsOn: string;
  endsOn: string;
  spreadMonths: string;
  purpose: string;
  driver: CostDriver;
  channel: string;
};

const blank = (): Form => ({
  name: "",
  vendor: "",
  category: "hosting",
  amount: "",
  currency: "NGN",
  frequency: "monthly",
  startsOn: today(),
  endsOn: "",
  spreadMonths: "",
  purpose: "",
  driver: "active_churches",
  channel: "",
});

function fromItem(i: CostItemView): Form {
  return {
    id: i.id,
    name: i.name,
    vendor: i.vendor ?? "",
    category: i.category,
    amount: String(i.amount),
    currency: i.currency === "USD" ? "USD" : "NGN",
    frequency: i.frequency,
    startsOn: i.startsOn,
    endsOn: i.endsOn ?? "",
    spreadMonths: i.spreadMonths ? String(i.spreadMonths) : "",
    purpose: i.purpose ?? "",
    driver: i.driver,
    channel: i.channel ?? "",
  };
}

const price = (amount: number, currency: string) => (currency === "USD" ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : formatMoney(amount));

type RowAction = { kind: "price" | "end" | "archive"; item: CostItemView } | null;

export function CostItems({
  items,
  measured,
  canManage,
  periodLabel,
  ngnPerUsd,
}: {
  items: CostItemView[];
  measured: CostLine[];
  canManage: boolean;
  periodLabel: string;
  ngnPerUsd: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<Form | null>(null);
  const [driverTouched, setDriverTouched] = useState(false);
  const [action, setAction] = useState<RowAction>(null);
  const [actionValue, setActionValue] = useState("");
  const [actionCurrency, setActionCurrency] = useState<"NGN" | "USD">("NGN");
  const [actionDate, setActionDate] = useState(today());

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const def = form ? categoryDef(form.category) : null;

  function openNew() {
    setDriverTouched(false);
    setForm(blank());
  }

  function save() {
    if (!form) return;
    const amount = Number(form.amount);
    if (!(amount >= 0) || form.amount.trim() === "") {
      toast.error("Enter what it costs.");
      return;
    }
    start(async () => {
      const res = await saveCostItem({
        id: form.id,
        name: form.name,
        vendor: form.vendor,
        category: form.category,
        amount,
        currency: form.currency,
        frequency: form.frequency,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        spreadMonths: form.frequency === "one_off" && form.spreadMonths ? Number(form.spreadMonths) : null,
        purpose: form.purpose,
        driver: form.driver,
        channel: form.channel,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Cost updated." : "Cost added.");
      setForm(null);
      router.refresh();
    });
  }

  function openAction(kind: NonNullable<RowAction>["kind"], item: CostItemView) {
    setAction({ kind, item });
    setActionValue(kind === "price" ? String(item.amount) : "");
    setActionCurrency(item.currency === "USD" ? "USD" : "NGN");
    setActionDate(today());
  }

  function runAction() {
    if (!action) return;
    start(async () => {
      const res =
        action.kind === "price"
          ? await changeCostPrice({ id: action.item.id, amount: Number(actionValue), currency: actionCurrency, from: actionDate })
          : action.kind === "end"
            ? await endCostItem({ id: action.item.id, endsOn: actionDate })
            : await archiveCostItem({ id: action.item.id, reason: actionValue });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(action.kind === "price" ? "New price saved." : action.kind === "end" ? "End date saved." : "Taken out of the figures.");
      setAction(null);
      router.refresh();
    });
  }

  const monthlyNgn = form && form.amount ? monthlyEquivalent(Number(form.amount) * (form.currency === "USD" ? ngnPerUsd : 1), form.frequency) : null;

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-2xl border">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-bold">What you pay for</p>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs">
              Bills the platform cannot see for itself. A yearly bill counts a twelfth a month; a price change starts a new line
              so past months keep the old price.
            </p>
          </div>
          {canManage && (
            <Button onClick={openNew} size="sm">
              <Plus className="size-4" /> Add a cost
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground border-t p-6 text-center text-sm">
            Nothing entered yet. Start with hosting, your domain and your email plan.
          </p>
        ) : (
          <ScrollableTable>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-muted-foreground border-y text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Cost</th>
                  <th className="px-3 py-2 text-left font-medium">Price</th>
                  <th className="px-3 py-2 text-left font-medium">Shared</th>
                  <th className="px-3 py-2 text-right font-medium">{periodLabel}</th>
                  {canManage && <th className="px-4 py-2 text-right font-medium">Change</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const eq = monthlyEquivalent(i.amountNgn, i.frequency);
                  const ended = i.endsOn && i.endsOn < today();
                  return (
                    <tr key={i.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">
                          {i.name}
                          {ended && <Badge variant="secondary" className="ml-2">Ended {i.endsOn}</Badge>}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {categoryDef(i.category).label}
                          {i.vendor ? ` · ${i.vendor}` : ""}
                          {i.channel ? ` · ${i.channel}` : ""}
                        </p>
                        {i.purpose && <p className="text-muted-foreground mt-1 max-w-sm text-xs italic">{i.purpose}</p>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p>
                          {price(i.amount, i.currency)} <span className="text-muted-foreground text-xs">{FREQUENCY_LABEL[i.frequency].toLowerCase()}</span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {eq != null && i.frequency !== "monthly" ? `${formatMoney(eq)} a month · ` : i.currency === "USD" ? `${formatMoney(i.amountNgn)} today · ` : ""}
                          from {i.startsOn}
                          {i.frequency === "one_off" && i.spreadMonths ? ` over ${i.spreadMonths} months` : ""}
                        </p>
                      </td>
                      <td className="text-muted-foreground max-w-[220px] px-3 py-2.5 text-xs">{DRIVER_LABEL[i.driver]}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <p className="font-medium">{formatMoney(i.inPeriod)}</p>
                        {i.untraced > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{formatMoney(i.untraced)} no church used</p>}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDriverTouched(true);
                                setForm(fromItem(i));
                              }}
                            >
                              Edit
                            </Button>
                            {i.frequency !== "one_off" && !ended && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => openAction("price", i)}>
                                  New price
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => openAction("end", i)}>
                                  Stop
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => openAction("archive", i)}>
                              Take out
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </section>

      <section className="bg-card rounded-2xl border">
        <div className="p-4">
          <p className="text-sm font-bold">Measured for you</p>
          <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs">
            Read from what actually happened. Nothing here needs typing in, and none of it should be entered above as well.
          </p>
        </div>
        {measured.length === 0 ? (
          <p className="text-muted-foreground border-t p-6 text-center text-sm">No SMS, AI, meeting, fee or reward costs in this period.</p>
        ) : (
          <ScrollableTable>
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {measured.map((l) => (
                  <tr key={l.key} className="border-t">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">
                        {l.label}
                        {l.basis === "estimated" && <Badge variant="outline" className="ml-2">Estimate</Badge>}
                      </p>
                      {l.detail && <p className="text-muted-foreground text-xs">{l.detail}</p>}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-xs">{BUCKET_LABEL[l.bucket]}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </section>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Change a cost" : "Add a cost"}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? "Correcting a mistake changes every month it covers. If the price itself changed, use New price instead."
                : "Something the platform pays for. Enter the price as the vendor charges it."}
            </DialogDescription>
          </DialogHeader>
          {form && def && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ci-name">Name</Label>
                <Input id="ci-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Contabo VPS" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-category">Kind</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => {
                    set("category", v);
                    if (!driverTouched) set("driver", categoryDef(v).driver);
                  }}
                >
                  <SelectTrigger id="ci-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_CATEGORIES.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-vendor">Paid to</Label>
                <Input id="ci-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Optional" maxLength={120} />
              </div>
              <p
                className={`text-xs sm:col-span-2 ${/\bNOT\b/.test(def.hint) ? "rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}
              >
                {def.hint}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="ci-amount">Price</Label>
                <div className="flex gap-2">
                  <Select value={form.currency} onValueChange={(v) => set("currency", v as "NGN" | "USD")}>
                    <SelectTrigger className="w-20" aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">₦</SelectItem>
                      <SelectItem value="USD">$</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input id="ci-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-frequency">How often</Label>
                <Select value={form.frequency} onValueChange={(v) => set("frequency", v as Frequency)}>
                  <SelectTrigger id="ci-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {monthlyNgn != null && form.frequency !== "monthly" && Number(form.amount) > 0 && (
                <p className="text-muted-foreground text-xs sm:col-span-2">That is {formatMoney(monthlyNgn)} a month.</p>
              )}
              {form.currency === "USD" && (
                <p className="text-muted-foreground text-xs sm:col-span-2">
                  Counted at ₦{Math.round(ngnPerUsd).toLocaleString()} per dollar. Set what your bank really charges under Accuracy.
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="ci-start">{form.frequency === "one_off" ? "Paid on" : "Started on"}</Label>
                <Input id="ci-start" type="date" value={form.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
              </div>
              {form.frequency === "one_off" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ci-spread">Spread over (months)</Label>
                  <Input
                    id="ci-spread"
                    inputMode="numeric"
                    value={form.spreadMonths}
                    onChange={(e) => set("spreadMonths", e.target.value.replace(/\D/g, ""))}
                    placeholder="Leave blank: all in that month"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="ci-end">Ended on</Label>
                  <Input id="ci-end" type="date" value={form.endsOn} onChange={(e) => set("endsOn", e.target.value)} />
                </div>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ci-driver">Shared between churches</Label>
                <Select
                  value={form.driver}
                  onValueChange={(v) => {
                    setDriverTouched(true);
                    set("driver", v as CostDriver);
                  }}
                >
                  <SelectTrigger id="ci-driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_DRIVERS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DRIVER_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  How much of this each church costs you. Marketing and running the business are never shared: they are not the cost of
                  serving anyone.
                </p>
              </div>

              {form.category === "marketing" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ci-channel">Channel</Label>
                  <Input
                    id="ci-channel"
                    list="ci-channels"
                    value={form.channel}
                    onChange={(e) => set("channel", e.target.value)}
                    placeholder="instagram, event, whatsapp…"
                    maxLength={40}
                  />
                  <datalist id="ci-channels">
                    {CHANNEL_SUGGESTIONS.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <p className="text-muted-foreground text-xs">Use the same word as the lead source in Growth, so the churches it brings are matched to it.</p>
                </div>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ci-purpose">What it lets you do</Label>
                <Textarea
                  id="ci-purpose"
                  rows={2}
                  value={form.purpose}
                  onChange={(e) => set("purpose", e.target.value)}
                  placeholder="Runs the app and the database for every church."
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form?.name.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {form?.id ? "Save" : "Add cost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "price" ? "New price" : action?.kind === "end" ? "Stop paying for it" : "Take it out of the figures"}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "price"
                ? `${action.item.name} keeps its old price for the months before, and costs the new one from the date you pick.`
                : action?.kind === "end"
                  ? `${action?.item.name} keeps counting for the months it was paid for, and stops after this day.`
                  : `For a cost entered by mistake. It leaves every figure, but stays on record. To stop paying for something, use Stop instead.`}
            </DialogDescription>
          </DialogHeader>
          {action?.kind === "price" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ca-amount">New price ({FREQUENCY_LABEL[action.item.frequency].toLowerCase()})</Label>
                <div className="flex gap-2">
                  <Select value={actionCurrency} onValueChange={(v) => setActionCurrency(v as "NGN" | "USD")}>
                    <SelectTrigger className="w-20" aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">₦</SelectItem>
                      <SelectItem value="USD">$</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input id="ca-amount" inputMode="decimal" value={actionValue} onChange={(e) => setActionValue(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ca-from">From</Label>
                <Input id="ca-from" type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
              </div>
            </div>
          )}
          {action?.kind === "end" && (
            <div className="space-y-1.5">
              <Label htmlFor="ca-end">Last day paid for</Label>
              <Input id="ca-end" type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
            </div>
          )}
          {action?.kind === "archive" && (
            <div className="space-y-1.5">
              <Label htmlFor="ca-reason">Why</Label>
              <Input id="ca-reason" value={actionValue} onChange={(e) => setActionValue(e.target.value)} placeholder="Entered twice" maxLength={200} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={runAction}
              disabled={pending || (action?.kind === "archive" && !actionValue.trim()) || (action?.kind === "price" && !(Number(actionValue) >= 0 && actionValue !== ""))}
              variant={action?.kind === "archive" ? "destructive" : "default"}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {action?.kind === "price" ? "Save new price" : action?.kind === "end" ? "Save end date" : "Take it out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
