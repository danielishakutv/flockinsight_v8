"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Banknote, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  decidePartnerPayout,
  savePartnerRates,
  savePartnerStatus,
} from "@/app/superadmin/partners/actions";
import type { PartnerRates } from "@/lib/partners-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AdminPartner = {
  id: string;
  code: string;
  displayName: string;
  status: "pending" | "active" | "suspended";
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  tierOverride: string | null;
  churches: number;
  createdAt: string;
};

type AdminPayout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  requestedAt: string;
  partnerName: string;
  partnerCode: string;
};

/**
 * The ladder, the people and the payouts.
 *
 * Rates are edited as PERCENTAGES here and stored as basis points, because
 * nobody thinks in basis points and nothing should round twice. Each number is
 * bounded on the way in and again on the server — a typed extra zero on a
 * commission rate would otherwise promise an agent four times what the church
 * paid us.
 */
export function PartnersAdmin({
  rates,
  partners,
  payouts,
}: {
  rates: PartnerRates;
  partners: AdminPartner[];
  payouts: AdminPayout[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(rates);
  const [paying, setPaying] = useState<AdminPayout | null>(null);
  const [reference, setReference] = useState("");

  const pct = (bps: number) => String(Math.round(bps) / 100);
  const toBps = (v: string) => Math.round((Number(v) || 0) * 100);

  function saveRates() {
    startTransition(async () => {
      const res = await savePartnerRates(draft);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Rates saved. New earnings use them from now on.");
      router.refresh();
    });
  }

  function setStatus(p: AdminPartner, status: AdminPartner["status"]) {
    startTransition(async () => {
      const res = await savePartnerStatus({
        partnerId: p.id,
        status,
        tierOverride: p.tierOverride ?? undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  function decide(payout: AdminPayout, status: "approved" | "paid" | "rejected") {
    if (status === "paid" && !reference.trim()) {
      return void toast.error("Add the transfer reference first.");
    }
    startTransition(async () => {
      const res = await decidePartnerPayout({
        payoutId: payout.id,
        status,
        reference: status === "paid" ? reference : undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Marked ${status}.`);
      setPaying(null);
      setReference("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Withdrawals first: this is the queue somebody is waiting on. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="text-primary size-4" />
            Withdrawals waiting ({payouts.length})
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Make the transfer, then mark it paid with the reference. Rejecting
            returns the money to the Partner&rsquo;s available balance rather
            than destroying it.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              Nothing waiting.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="font-semibold">
                      {formatMoney(p.amount, p.currency)} — {p.partnerName}{" "}
                      <span className="text-muted-foreground font-mono text-xs">
                        {p.partnerCode}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {p.bankName} · {p.bankAccountNumber} · {p.bankAccountName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Requested {new Date(p.requestedAt).toLocaleString()} ·{" "}
                      {p.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {p.status === "requested" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide(p, "approved")}
                        disabled={pending}
                      >
                        Approve
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setPaying(p)} disabled={pending}>
                      Mark paid
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => decide(p, "rejected")}
                      disabled={pending}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The ladder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rates and tiers</CardTitle>
          <p className="text-muted-foreground text-sm">
            Percentages of what a church actually pays. A tier is reached on
            churches <strong>live and paying</strong> inside the rolling window —
            never on sign-ups, or the programme pays for churn.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScrollableTable hint="Scroll for more" label="Tiers">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                <tr>
                  <th className="px-2 py-2 font-semibold">Tier</th>
                  <th className="px-2 py-2 font-semibold">Churches needed</th>
                  <th className="px-2 py-2 font-semibold">1st payment %</th>
                  <th className="px-2 py-2 font-semibold">2nd payment %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {draft.tiers.map((t, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">
                      <Input
                        value={t.name}
                        className="h-9"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tiers: d.tiers.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={String(t.minChurches)}
                        inputMode="numeric"
                        className="h-9 w-24"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tiers: d.tiers.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    minChurches: Number(
                                      e.target.value.replace(/[^0-9]/g, ""),
                                    ),
                                  }
                                : x,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={pct(t.firstBps)}
                        inputMode="decimal"
                        className="h-9 w-24"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tiers: d.tiers.map((x, j) =>
                              j === i ? { ...x, firstBps: toBps(e.target.value) } : x,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={pct(t.secondBps)}
                        inputMode="decimal"
                        className="h-9 w-24"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tiers: d.tiers.map((x, j) =>
                              j === i ? { ...x, secondBps: toBps(e.target.value) } : x,
                            ),
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>

          <div className="grid gap-3 sm:grid-cols-4">
            <Num
              label="Monthly share %"
              value={pct(draft.trailBps)}
              onChange={(v) => setDraft((d) => ({ ...d, trailBps: toBps(v) }))}
              hint="Of every payment after the first two"
            />
            <Num
              label="For how many months"
              value={String(draft.trailMonths)}
              onChange={(v) =>
                setDraft((d) => ({ ...d, trailMonths: Number(v.replace(/[^0-9]/g, "")) }))
              }
            />
            <Num
              label="Smallest withdrawal"
              value={String(draft.minPayout)}
              onChange={(v) =>
                setDraft((d) => ({ ...d, minPayout: Number(v.replace(/[^0-9]/g, "")) }))
              }
            />
            <Num
              label="Tier window (days)"
              value={String(draft.tierWindowDays)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  tierWindowDays: Number(v.replace(/[^0-9]/g, "")) || 1,
                }))
              }
              hint="Rolling, not a calendar month"
            />
          </div>

          <Button onClick={saveRates} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save rates
          </Button>
          <p className="text-muted-foreground text-xs">
            Changing a rate affects earnings recorded from now on. Earnings
            already in the ledger keep the rate they were paid at — each row
            stores it.
          </p>
        </CardContent>
      </Card>

      {/* The people */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Partners ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {partners.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              Nobody has applied yet.
            </p>
          ) : (
            <ScrollableTable stickyFirstColumn hint="Scroll for more" label="Partners">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Partner</th>
                    <th className="px-3 py-2 text-right font-semibold">Churches</th>
                    <th className="px-3 py-2 font-semibold">Verified</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {partners.map((p) => (
                    <tr key={p.id} className="hover:bg-accent/30">
                      <td className="px-3 py-2">
                        <p className="font-medium">{p.displayName}</p>
                        <p className="text-muted-foreground font-mono text-xs">
                          {p.code}
                          {p.phone ? ` · ${p.phone}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.churches}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "text-xs",
                            p.emailVerified && p.phoneVerified
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        >
                          {p.emailVerified && p.phoneVerified ? (
                            <span className="flex items-center gap-1">
                              <BadgeCheck className="size-3.5" /> both
                            </span>
                          ) : (
                            [
                              p.emailVerified ? "email" : null,
                              p.phoneVerified ? "phone" : null,
                            ]
                              .filter(Boolean)
                              .join(", ") || "neither"
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={p.status}
                          onValueChange={(v) =>
                            setStatus(p, v as AdminPartner["status"])
                          }
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Mark paid */}
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {paying ? formatMoney(paying.amount, paying.currency) : ""} as paid
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Paid to {paying?.bankName} · {paying?.bankAccountNumber} ·{" "}
              {paying?.bankAccountName}
            </p>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Transfer reference"
            />
            <p className="text-muted-foreground text-xs">
              The reference is required so this can be reconciled against the
              bank later.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => paying && decide(paying, "paid")}
              disabled={pending || !reference.trim()}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
        {label}
      </label>
      <Input
        value={value}
        inputMode="decimal"
        className="h-9"
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
}
