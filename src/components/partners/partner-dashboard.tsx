"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Banknote,
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  LifeBuoy,
  Loader2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  confirmPartnerOtp,
  raiseTicketForChurch,
  requestPartnerPayout,
  savePartnerBank,
  savePartnerPhone,
  sendPartnerOtp,
} from "@/app/partner/actions";
import {
  canWithdraw,
  type PartnerRates,
  type PartnerTier,
} from "@/lib/partners-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Wallet = { available: number; pending: number; paid: number; lifetime: number };

type Earning = {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  rateBps: number;
  status: string;
  churchName: string | null;
  createdAt: string;
};

type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  requestedAt: string;
  paidAt: string | null;
};

type PartnerChurch = {
  churchId: string;
  name: string;
  plan: string;
  status: string;
  city: string | null;
  country: string;
  signedUpAt: string;
  payments: number;
  lastPaidAt: string | null;
  earned: number;
};

const KIND_LABEL: Record<string, string> = {
  first: "First payment",
  second: "Second payment",
  trail: "Monthly share",
  bonus: "Bonus",
};

/**
 * A Partner's whole dashboard.
 *
 * The balance hides behind a tap, because a field agent opens this on a phone
 * in front of the pastor they are signing up, and what they earn is not that
 * pastor's business. The choice is remembered on the device, not on the server
 * — it is about this screen in this room.
 */
export function PartnerDashboard({
  partner,
  email,
  shareLink,
  wallet,
  rates,
  tier,
  liveChurches,
  ahead,
  openRequest,
  churches,
  earnings,
  payouts,
}: {
  partner: {
    id: string;
    code: string;
    displayName: string;
    status: "pending" | "active" | "suspended";
    phone: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
  };
  email: string;
  shareLink: string;
  wallet: Wallet;
  rates: PartnerRates;
  tier: PartnerTier;
  liveChurches: number;
  ahead: { tier: PartnerTier; needed: number } | null;
  openRequest: boolean;
  churches: PartnerChurch[];
  earnings: Earning[];
  payouts: Payout[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [shown, setShown] = useState(false);
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState({
    bankName: partner.bankName ?? "",
    bankAccountNumber: partner.bankAccountNumber ?? "",
    bankAccountName: partner.bankAccountName ?? "",
  });
  const [phone, setPhone] = useState(partner.phone ?? "");
  const [otp, setOtp] = useState<{ which: "email" | "phone"; id: string } | null>(null);
  const [code, setCode] = useState("");
  const [ticketFor, setTicketFor] = useState<PartnerChurch | null>(null);
  const [ticket, setTicket] = useState({ subject: "", body: "" });

  const hasBank = !!(
    partner.bankName &&
    partner.bankAccountNumber &&
    partner.bankAccountName
  );

  /*
   * The same function the server uses, so the button and the rule can never
   * disagree. The disabled state is a courtesy; the action re-checks.
   */
  const verdict = canWithdraw({
    rates,
    available: wallet.available,
    amount: Number(amount) || 0,
    status: partner.status,
    hasBank,
    emailVerified: partner.emailVerified,
    phoneVerified: partner.phoneVerified,
    openRequest,
  });

  const money = (n: number) => formatMoney(n, "NGN");
  const hidden = "•••••••";

  function withdraw() {
    startTransition(async () => {
      const res = await requestPartnerPayout({ amount: Number(amount) });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Withdrawal requested. We'll pay it to your account.");
      setAmount("");
      router.refresh();
    });
  }

  function saveBank() {
    startTransition(async () => {
      const res = await savePartnerBank(bank);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Account details saved.");
      router.refresh();
    });
  }

  function savePhone() {
    startTransition(async () => {
      const res = await savePartnerPhone({ phone });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Phone number saved. Verify it to withdraw.");
      router.refresh();
    });
  }

  function startVerify(which: "email" | "phone") {
    startTransition(async () => {
      const res = await sendPartnerOtp(which);
      if (!res.ok) return void toast.error(res.error);
      setOtp({ which, id: res.id });
      setCode("");
      toast.success(
        which === "email" ? "Code sent to your email." : "Code sent by SMS.",
      );
    });
  }

  function finishVerify() {
    if (!otp) return;
    startTransition(async () => {
      const res = await confirmPartnerOtp({ which: otp.which, id: otp.id, code });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Verified.");
      setOtp(null);
      router.refresh();
    });
  }

  function sendTicket() {
    const church = ticketFor;
    if (!church) return;
    startTransition(async () => {
      const res = await raiseTicketForChurch({
        churchId: church.churchId,
        subject: ticket.subject,
        body: ticket.body,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Sent to support. They'll reply by email.");
      setTicketFor(null);
      setTicket({ subject: "", body: "" });
    });
  }

  return (
    <div className="space-y-6">
      {partner.status !== "active" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {partner.status === "pending"
            ? "Your Partner account is waiting to be approved. You can share your link and sign churches up now — your earnings are recorded either way, and you can withdraw once you are approved."
            : "Your Partner account is suspended. Please contact support."}
        </div>
      )}

      {/* Wallet */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="text-primary size-4" />
            Your wallet
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? "Hide balance" : "Show balance"}
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {shown ? "Hide" : "Show"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label="Available" value={shown ? money(wallet.available) : hidden} strong />
            <Figure label="Pending" value={shown ? money(wallet.pending) : hidden} />
            <Figure label="Paid out" value={shown ? money(wallet.paid) : hidden} />
            <Figure label="Lifetime" value={shown ? money(wallet.lifetime) : hidden} />
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-32 flex-1">
              <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
                Amount to withdraw
              </label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder={String(rates.minPayout)}
                className="h-11"
              />
            </div>
            <Button
              size="lg"
              className="h-11"
              onClick={withdraw}
              disabled={pending || !verdict.ok}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Banknote className="size-4" />
              )}
              Withdraw
            </Button>
          </div>
          {/*
            Why the button is off, in words. A disabled button with nothing
            beside it is the most common way a payout turns into a support
            ticket.
          */}
          {!verdict.ok && (
            <p className="text-muted-foreground text-xs">{verdict.reason}</p>
          )}
          <p className="text-muted-foreground text-xs">
            Smallest withdrawal is {money(rates.minPayout)}. Paid to your bank
            account, usually within two working days.
          </p>
        </CardContent>
      </Card>

      {/* Tier + link */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="text-primary size-4" />
              {tier.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              You earn <strong>{(tier.firstBps / 100).toFixed(0)}%</strong> of a
              church&rsquo;s first two payments
              {rates.trailBps > 0 && (
                <>
                  , then <strong>{(rates.trailBps / 100).toFixed(0)}%</strong> of
                  every payment for {rates.trailMonths} months
                </>
              )}
              .
            </p>
            <p className="text-muted-foreground">
              {liveChurches} church{liveChurches === 1 ? "" : "es"} live and paying
              in the last {rates.tierWindowDays} days.
            </p>
            {ahead && (
              <p className="text-muted-foreground">
                {ahead.needed} more and you reach{" "}
                <strong>{ahead.tier.name}</strong> at{" "}
                {(ahead.tier.firstBps / 100).toFixed(0)}%.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your referral link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={shareLink} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy your link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareLink)
                    .then(() => toast.success("Link copied."))
                    .catch(() => toast.error("Could not copy the link."));
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Your code is <strong className="font-mono">{partner.code}</strong> —
              short enough to read down a phone line. Any church that signs up
              within 30 days of following your link is credited to you.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Identity + bank */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeCheck className="text-primary size-4" />
            Getting paid
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            We verify your email and phone before sending money, and pay into the
            account below.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <VerifyRow
              label="Email"
              value={email}
              verified={partner.emailVerified}
              onVerify={() => startVerify("email")}
              busy={pending}
            />
            <div className="space-y-2">
              <VerifyRow
                label="Phone"
                value={partner.phone ?? "Not set"}
                verified={partner.phoneVerified}
                onVerify={() => startVerify("phone")}
                busy={pending}
                disabled={!partner.phone}
              />
              <div className="flex gap-2">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08012345678"
                  className="h-9"
                />
                <Button size="sm" variant="outline" onClick={savePhone} disabled={pending}>
                  Save
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <Field
              label="Bank"
              value={bank.bankName}
              onChange={(v) => setBank((b) => ({ ...b, bankName: v }))}
              placeholder="e.g. GTBank"
            />
            <Field
              label="Account number"
              value={bank.bankAccountNumber}
              onChange={(v) =>
                setBank((b) => ({ ...b, bankAccountNumber: v.replace(/[^0-9]/g, "") }))
              }
              placeholder="0123456789"
            />
            <Field
              label="Account name"
              value={bank.bankAccountName}
              onChange={(v) => setBank((b) => ({ ...b, bankAccountName: v }))}
              placeholder="As it appears at the bank"
            />
          </div>
          <Button size="sm" onClick={saveBank} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save account details
          </Button>
        </CardContent>
      </Card>

      {/* Churches */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="text-primary size-4" />
            Churches you brought ({churches.length})
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            How each one is doing, and what you have earned from it. You can raise
            a support ticket on their behalf.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {churches.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">
              Nothing yet. Share your link, or walk a church through signing up
              with your code.
            </p>
          ) : (
            <ScrollableTable stickyFirstColumn hint="Scroll for more" label="Churches">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Church</th>
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 text-right font-semibold">Payments</th>
                    <th className="px-3 py-2 text-right font-semibold">You earned</th>
                    <th className="px-3 py-2 font-semibold">Signed up</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {churches.map((c) => (
                    <tr key={c.churchId} className="hover:bg-accent/30">
                      <td className="px-3 py-2">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {[c.city, c.country].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="capitalize">{c.plan}</span>
                        {c.status !== "active" && (
                          <span className="text-destructive ml-1 text-xs">
                            ({c.status})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.payments || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {shown ? money(c.earned) : hidden}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {new Date(c.signedUpAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setTicketFor(c)}
                          disabled={partner.status !== "active"}
                        >
                          <LifeBuoy className="size-4" /> Help
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Ledger */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Earnings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {earnings.length === 0 ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                Nothing earned yet.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {earnings.slice(0, 40).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {e.churchName ?? "A church"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {KIND_LABEL[e.kind] ?? e.kind} ·{" "}
                        {(e.rateBps / 100).toFixed(0)}% ·{" "}
                        {new Date(e.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {shown ? formatMoney(e.amount, e.currency) : hidden}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase",
                        e.status === "paid"
                          ? "bg-muted text-muted-foreground"
                          : e.status === "available"
                            ? "bg-primary/10 text-primary"
                            : "bg-amber-500/10 text-amber-600",
                      )}
                    >
                      {e.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Withdrawals</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payouts.length === 0 ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                No withdrawals yet.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {payouts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold tabular-nums">
                        {shown ? formatMoney(p.amount, p.currency) : hidden}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Requested {new Date(p.requestedAt).toLocaleDateString()}
                        {p.paidAt &&
                          ` · paid ${new Date(p.paidAt).toLocaleDateString()}`}
                        {p.reference && ` · ${p.reference}`}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase",
                        p.status === "paid"
                          ? "bg-primary/10 text-primary"
                          : p.status === "rejected"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600",
                      )}
                    >
                      {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Verify dialog */}
      <Dialog open={!!otp} onOpenChange={(o) => !o && setOtp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Enter the code we sent to your {otp?.which === "email" ? "email" : "phone"}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            maxLength={8}
            placeholder="123456"
            className="text-center text-xl tracking-[0.4em]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOtp(null)}>
              Cancel
            </Button>
            <Button onClick={finishVerify} disabled={pending || code.length < 4}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              <Check className="size-4" /> Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ticket dialog */}
      <Dialog open={!!ticketFor} onOpenChange={(o) => !o && setTicketFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a ticket for {ticketFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={ticket.subject}
              onChange={(e) => setTicket((t) => ({ ...t, subject: e.target.value }))}
              placeholder="What is it about?"
            />
            <Textarea
              value={ticket.body}
              onChange={(e) => setTicket((t) => ({ ...t, body: e.target.value }))}
              placeholder="What is happening, and what have they already tried?"
              rows={6}
            />
            <p className="text-muted-foreground text-xs">
              Support will see this came from you rather than from the church, so
              they know who they are replying to.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTicketFor(null)}>
              Cancel
            </Button>
            <Button onClick={sendTicket} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Send to support
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-accent/40 rounded-xl p-3">
      <p className="text-muted-foreground text-xs font-semibold uppercase">{label}</p>
      <p
        className={cn(
          "truncate tabular-nums",
          strong ? "text-primary text-2xl font-extrabold" : "text-lg font-bold",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs font-semibold uppercase">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );
}

function VerifyRow({
  label,
  value,
  verified,
  onVerify,
  busy,
  disabled,
}: {
  label: string;
  value: string;
  verified: boolean;
  onVerify: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs font-semibold uppercase">
          {label}
        </p>
        <p className="truncate text-sm">{value}</p>
      </div>
      {verified ? (
        <span className="text-primary flex shrink-0 items-center gap-1 text-xs font-semibold">
          <BadgeCheck className="size-4" /> Verified
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={onVerify}
          disabled={busy || disabled}
        >
          Verify
        </Button>
      )}
    </div>
  );
}
