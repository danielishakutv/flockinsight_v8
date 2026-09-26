"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  adjustWallet,
  markPaymentReceived,
  setTrial,
  voidPayment,
} from "@/app/superadmin/finance/actions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { ScrollableTable } from "@/components/ui/scrollable-table";

type ChurchRow = {
  id: string;
  name: string;
  plan: string;
  discountPct: number;
  walletBalance: number;
  trialEndsAt: string | null;
  trialState: "none" | "active" | "ending_soon" | "expired";
  planRenewsAt: string | null;
  monthly: number;
  zeroReason: "trial" | "lapsed" | "free" | "custom" | null;
  referredByName: string | null;
  referralRewardedAt: string | null;
};

type PaymentRow = {
  id: string;
  churchId: string;
  churchName: string | null;
  plan: string | null;
  amount: number;
  gateway: string;
  reference: string;
  status: "pending" | "success" | "failed";
  periodMonths: number | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
};

type Movement = {
  id: string;
  churchName: string | null;
  kind: string;
  category: string | null;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
};

type Topup = {
  id: string;
  churchName: string | null;
  amount: number;
  reference: string;
  createdAt: string;
};

const TABS = [
  { id: "churches", label: "By church" },
  { id: "payments", label: "Payments" },
  { id: "wallets", label: "Wallets" },
  { id: "trials", label: "Trials" },
  { id: "referrals", label: "Referrals" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FinanceTabs({
  churches,
  payments,
  movements,
  topups,
  gateways,
  trials,
}: {
  churches: ChurchRow[];
  payments: PaymentRow[];
  movements: Movement[];
  topups: Topup[];
  gateways: { gateway: string; total: number; count: number }[];
  trials: { active: number; endingSoon: number; expired: number };
}) {
  const [tab, setTab] = useState<TabId>("churches");
  const [q, setQ] = useState("");
  const [walletFor, setWalletFor] = useState<ChurchRow | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [asAdvance, setAsAdvance] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  const filteredChurches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? churches.filter((c) => c.name.toLowerCase().includes(s)) : churches;
  }, [churches, q]);

  function openAdjust(c: ChurchRow) {
    setWalletFor(c);
    setWalletAmount("");
    setWalletReason("");
    setAsAdvance(false);
  }

  function submitAdjust() {
    if (!walletFor) return;
    const amount = Number(walletAmount);
    if (!amount) {
      toast.error("Enter an amount.");
      return;
    }
    if (!walletReason.trim()) {
      toast.error("A reason is required — it shows on their statement.");
      return;
    }
    start(async () => {
      const res = await adjustWallet({
        churchId: walletFor.id,
        amount,
        reason: walletReason,
        asAdvance,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        amount < 0 && asAdvance ? "Advance recorded." : "Wallet adjusted.",
      );
      setWalletFor(null);
      router.refresh();
    });
  }

  function doConfirm(p: PaymentRow) {
    start(async () => {
      const res = await markPaymentReceived(p.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Marked as received.");
      router.refresh();
    });
  }

  function doTrial(c: ChurchRow) {
    const raw = window.prompt(
      `How many more Sundays free for ${c.name}?\n\n0 ends the trial now and turns the paywall on.`,
      "4",
    );
    if (raw === null) return;
    const sundays = Number(raw);
    if (Number.isNaN(sundays)) return toast.error("Enter a number.");
    start(async () => {
      const res = await setTrial({ churchId: c.id, sundays });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(sundays > 0 ? "Trial extended." : "Trial ended.");
      router.refresh();
    });
  }

  function doVoid(p: PaymentRow) {
    const reason = window.prompt(
      `Void this ${formatMoney(p.amount)} payment? It stops counting as revenue.\n\nWhy?`,
      "",
    );
    if (!reason?.trim()) return;
    start(async () => {
      const res = await voidPayment(p.id, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Payment voided.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "churches" && (
          <div className="relative ml-auto min-w-48">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a church"
              className="pl-9"
            />
          </div>
        )}
        {pending && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
      </div>

      <div className="bg-card overflow-hidden rounded-2xl border">
        {tab === "churches" && (
          <Table
            head={["Church", "Plan", "Per month", "Wallet", "Renews", ""]}
            rows={filteredChurches.map((c) => [
              <Link
                key="n"
                href={`/superadmin/churches/${c.id}`}
                className="font-semibold hover:underline"
              >
                {c.name}
              </Link>,
              <span key="p" className="capitalize">
                {c.plan}
                {c.discountPct > 0 && (
                  <Badge variant="secondary" className="ml-1.5">
                    {c.discountPct}% off
                  </Badge>
                )}
              </span>,
              <span key="m" className={c.monthly === 0 ? "text-muted-foreground" : "font-semibold"}>
                {c.monthly === 0 ? trialLabel(c) : formatMoney(c.monthly)}
              </span>,
              <span
                key="w"
                className={c.walletBalance < 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""}
              >
                {c.walletBalance < 0
                  ? `${formatMoney(Math.abs(c.walletBalance))} owing`
                  : formatMoney(c.walletBalance)}
              </span>,
              c.planRenewsAt ? format(new Date(c.planRenewsAt), "d MMM yyyy") : "—",
              <div key="a" className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => openAdjust(c)}>
                  Wallet
                </Button>
                <Button size="sm" variant="ghost" onClick={() => doTrial(c)}>
                  Trial
                </Button>
              </div>,
            ])}
            empty="No churches yet."
          />
        )}

        {tab === "payments" && (
          <Table
            head={["Church", "Amount", "How", "Status", "Paid", ""]}
            rows={payments.map((p) => [
              p.churchName ?? <span key="d" className="text-muted-foreground">Deleted church</span>,
              <span key="a" className="font-semibold">{formatMoney(p.amount)}</span>,
              <span key="g" className="capitalize">
                {p.gateway}
                {p.periodMonths ? ` · ${p.periodMonths}mo` : ""}
              </span>,
              <StatusBadge key="s" status={p.status} />,
              p.paidAt ? format(new Date(p.paidAt), "d MMM yyyy") : "—",
              <div key="v" className="flex justify-end gap-1">
                {p.status === "pending" && (
                  <Button size="sm" variant="outline" onClick={() => doConfirm(p)}>
                    Mark received
                  </Button>
                )}
                {p.status !== "failed" && (
                  <Button size="sm" variant="ghost" onClick={() => doVoid(p)}>
                    Void
                  </Button>
                )}
              </div>,
            ])}
            empty="No payments recorded yet."
          />
        )}

        {tab === "wallets" && (
          <div className="divide-y">
            {topups.length > 0 && (
              <div className="p-4">
                <p className="text-sm font-bold">
                  Top-ups waiting on the gateway ({topups.length})
                </p>
                <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
                  Started but never confirmed. The money has not been added.
                </p>
                <Table
                  head={["Church", "Amount", "Reference", "Started"]}
                  rows={topups.map((t) => [
                    t.churchName ?? "—",
                    formatMoney(t.amount),
                    <span key="r" className="font-mono text-xs">{t.reference}</span>,
                    format(new Date(t.createdAt), "d MMM, h:mm a"),
                  ])}
                  empty=""
                  flush
                />
              </div>
            )}
            <div className="p-4">
              <p className="text-sm font-bold">Recent wallet movements</p>
              <div className="mt-3">
                <Table
                  head={["Church", "Movement", "Amount", "Left", "When"]}
                  rows={movements.map((m) => [
                    m.churchName ?? "—",
                    <span key="c" className="capitalize">
                      {m.category ?? m.kind}
                    </span>,
                    <span
                      key="a"
                      className={m.kind === "credit" ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}
                    >
                      {m.kind === "credit" ? "+" : "−"}
                      {formatMoney(m.amount)}
                    </span>,
                    formatMoney(m.balanceAfter),
                    format(new Date(m.createdAt), "d MMM, h:mm a"),
                  ])}
                  empty="Nothing yet."
                  flush
                />
              </div>
            </div>
            {gateways.length > 0 && (
              <div className="p-4">
                <p className="text-sm font-bold">Where the money came from</p>
                <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
                  Collected over the last year.
                </p>
                <Table
                  head={["Route", "Collected", "Payments"]}
                  rows={gateways.map((g) => [
                    <span key="g" className="capitalize">{g.gateway}</span>,
                    <span key="t" className="font-semibold">{formatMoney(g.total)}</span>,
                    String(g.count),
                  ])}
                  empty=""
                  flush
                />
              </div>
            )}
          </div>
        )}

        {tab === "trials" && (
          <div>
            <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
              <Mini label="On trial" value={trials.active} />
              <Mini label="Ending within 10 days" value={trials.endingSoon} warn />
              <Mini label="Ended, not converted" value={trials.expired} />
            </div>
            <Table
              head={["Church", "Plan", "Trial ends", "State", ""]}
              rows={churches
                .filter((c) => c.trialState !== "none")
                .sort((a, b) => (a.trialEndsAt ?? "").localeCompare(b.trialEndsAt ?? ""))
                .map((c) => [
                  <Link key="n" href={`/superadmin/churches/${c.id}`} className="font-semibold hover:underline">
                    {c.name}
                  </Link>,
                  <span key="p" className="capitalize">{c.plan}</span>,
                  c.trialEndsAt ? format(new Date(c.trialEndsAt), "d MMM yyyy") : "—",
                  <TrialBadge key="s" state={c.trialState} />,
                  <div key="a" className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => doTrial(c)}>
                      Change
                    </Button>
                  </div>,
                ])}
              empty="Nobody is on a trial."
            />
          </div>
        )}

        {tab === "referrals" && (
          <Table
            head={["Church", "Referred by", "Reward", "Plan"]}
            rows={churches
              .filter((c) => c.referredByName)
              .map((c) => [
                <Link key="n" href={`/superadmin/churches/${c.id}`} className="font-semibold hover:underline">
                  {c.name}
                </Link>,
                c.referredByName ?? "—",
                c.referralRewardedAt ? (
                  <Badge key="r" variant="secondary">
                    Paid {format(new Date(c.referralRewardedAt), "d MMM yyyy")}
                  </Badge>
                ) : (
                  <span key="r" className="text-muted-foreground">
                    {c.trialState === "active" || c.trialState === "ending_soon"
                      ? "Waiting — still on trial"
                      : "Not yet paid"}
                  </span>
                ),
                <span key="p" className="capitalize">{c.plan}</span>,
              ])}
            empty="No church has been referred yet."
          />
        )}
      </div>

      <Dialog open={walletFor !== null} onOpenChange={(o) => !o && setWalletFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{walletFor?.name}&apos;s wallet</DialogTitle>
            <DialogDescription>
              {walletFor && walletFor.walletBalance < 0
                ? `They currently owe ${formatMoney(Math.abs(walletFor.walletBalance))}.`
                : `They currently have ${formatMoney(walletFor?.walletBalance ?? 0)}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wa-amount">Amount (₦)</Label>
              <Input
                id="wa-amount"
                type="number"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                placeholder="5000, or -5000 to take it back"
              />
              <p className="text-muted-foreground text-xs">
                Positive adds credit. Negative takes it away.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wa-reason">Reason</Label>
              <Input
                id="wa-reason"
                value={walletReason}
                onChange={(e) => setWalletReason(e.target.value)}
                placeholder="Shows on their statement"
              />
            </div>

            {Number(walletAmount) < 0 && (
              <label className="flex items-start gap-2.5 rounded-xl border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={asAdvance}
                  onChange={(e) => setAsAdvance(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="font-semibold">
                    Let this go below zero (an advance)
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    They end up owing the difference, and their next top-up
                    clears it before anything else. Without this, a debit larger
                    than their balance is refused.
                  </span>
                </span>
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setWalletFor(null)}>
              Cancel
            </Button>
            <Button onClick={submitAdjust} disabled={pending || !walletAmount}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {Number(walletAmount) < 0 && asAdvance ? "Record advance" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Zero has four meanings and they need four different responses, so say which.
 * The server works this out; this only puts words to it.
 */
function trialLabel(c: ChurchRow): string {
  switch (c.zeroReason) {
    case "trial":
      return "On trial";
    case "lapsed":
      return "Lapsed";
    case "free":
      return "Free plan";
    case "custom":
      return "Priced per deal";
    default:
      return "—";
  }
}

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("mt-1 text-xl font-extrabold", warn && value > 0 && "text-amber-600 dark:text-amber-400")}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "success" | "failed" }) {
  if (status === "success") return <Badge variant="secondary">Received</Badge>;
  if (status === "pending")
    return (
      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
        Pending
      </Badge>
    );
  return <Badge variant="outline">Failed</Badge>;
}

function TrialBadge({ state }: { state: ChurchRow["trialState"] }) {
  if (state === "expired") return <Badge variant="outline">Ended</Badge>;
  if (state === "ending_soon")
    return (
      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
        Ending soon
      </Badge>
    );
  return <Badge variant="secondary">Running</Badge>;
}

function Table({
  head,
  rows,
  empty,
  flush,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
  flush?: boolean;
}) {
  if (rows.length === 0) {
    return empty ? (
      <p className={cn("text-muted-foreground text-sm", flush ? "" : "p-6 text-center")}>
        {empty}
      </p>
    ) : null;
  }
  return (
    // One helper behind seven tabs, so the column count varies from two to six.
    // No floor on the width: a table forced to 34rem would scroll a
    // two-column list for no reason, while one that genuinely needs more room
    // already grows past its container on its own and the scroller catches it.
    <ScrollableTable stickyFirstColumn label={head[0]}>
      <table className="w-full text-sm">
      <thead className="text-muted-foreground border-b text-left text-xs">
        <tr>
          {head.map((h, i) => (
            <th key={i} className={cn("px-4 py-2 font-medium", i === head.length - 1 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-accent/40">
            {r.map((cell, j) => (
              <td key={j} className={cn("px-4 py-2.5", j === r.length - 1 && "text-right")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      </table>
    </ScrollableTable>
  );
}
