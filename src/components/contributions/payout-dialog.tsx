"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { savePayout, type PayoutInput } from "@/app/(app)/contributions/actions";
import type { PayoutRow } from "@/lib/contributions";
import {
  METHOD_LABEL,
  PAYOUT_KINDS,
  type PayoutKind,
} from "@/lib/contributions-shared";
import { currencySymbol, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, MoneyInput } from "@/components/contributions/pieces";
import { ProofField, type ProofValue } from "@/components/contributions/proof-field";
import { useT } from "@/components/i18n-provider";
import type { TKey } from "@/lib/i18n/translate";

const METHODS = ["cash", "transfer", "card", "cheque", "online", "other"] as const;
const NONE = "__none__";

const KIND_LABEL_KEY: Record<PayoutKind, TKey> = {
  handover: "contributions.payoutHandover",
  expense: "contributions.payoutExpense",
  withdrawal: "contributions.payoutWithdrawal",
  refund: "contributions.payoutRefund",
};
const KIND_BLURB_KEY: Record<PayoutKind, TKey> = {
  handover: "contributions.payoutHandoverBlurb",
  expense: "contributions.payoutExpenseBlurb",
  withdrawal: "contributions.payoutWithdrawalBlurb",
  refund: "contributions.payoutRefundBlurb",
};

/**
 * Recording money leaving the collection.
 *
 * The available balance is printed above the amount field, not validated after
 * the fact. A treasurer about to write 50,000 out of a pot holding 42,000 should
 * see that before they type, and "available" here means confirmed in, less
 * everything already approved OR waiting for approval — because two people each
 * raising a payout for the whole balance is exactly how a pot ends up overdrawn
 * with cash in somebody's hand.
 */
export function PayoutDialog({
  open,
  onOpenChange,
  potId,
  currency,
  today,
  available,
  approvalsRequired,
  financeAccounts,
  canPostToFinance,
  editing,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  today: string;
  available: number;
  approvalsRequired: number;
  financeAccounts: { id: string; name: string }[];
  canPostToFinance: boolean;
  editing?: PayoutRow | null;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("contributions.recordPayout")}</DialogTitle>
        </DialogHeader>
        {/* State lives in the child so it is born fresh each time the dialog
            opens — see the note on EntryDialog. */}
        <PayoutForm
          onOpenChange={onOpenChange}
          potId={potId}
          currency={currency}
          today={today}
          available={available}
          approvalsRequired={approvalsRequired}
          financeAccounts={financeAccounts}
          canPostToFinance={canPostToFinance}
          editing={editing}
        />
      </DialogContent>
    </Dialog>
  );
}

function PayoutForm({
  onOpenChange,
  potId,
  currency,
  today,
  available,
  approvalsRequired,
  financeAccounts,
  canPostToFinance,
  editing,
}: {
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  today: string;
  available: number;
  approvalsRequired: number;
  financeAccounts: { id: string; name: string }[];
  canPostToFinance: boolean;
  editing?: PayoutRow | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [kind, setKind] = useState<PayoutKind>(editing?.kind ?? "expense");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? today);
  const [payee, setPayee] = useState(editing?.payee ?? "");
  const [purpose, setPurpose] = useState(editing?.purpose ?? "");
  const [method, setMethod] = useState<string | null>(editing?.method ?? "cash");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [proof, setProof] = useState<ProofValue>(null);
  const [post, setPost] = useState(!!editing?.financeTransactionId);
  const [accountId, setAccountId] = useState<string | null>(
    financeAccounts[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const payload: PayoutInput = {
      id: editing?.id,
      contributionId: potId,
      kind,
      amount,
      paidOn,
      payee,
      purpose,
      method,
      reference,
      proofMediaId: proof?.mediaId ?? null,
      financeAccountId: kind === "handover" && post ? accountId : null,
    };
    start(async () => {
      const res = await savePayout(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("contributions.saved"));
      onOpenChange(false);
      router.refresh();
    });
  }

  const symbol = currencySymbol(currency);

  return (
    <>
      <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("contributions.payoutKind")}</p>
            <div className="grid gap-2">
              {PAYOUT_KINDS.map((k) => {
                const picked = kind === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    aria-pressed={picked}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      picked ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                        picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {picked && <Check className="size-3" aria-hidden />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {t(KIND_LABEL_KEY[k.id])}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t(KIND_BLURB_KEY[k.id])}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("contributions.amountPaid")}
              htmlFor="payout-amount"
              hint={`${t("contributions.availableToPayOut")}: ${formatMoney(available, currency)}`}
            >
              <MoneyInput
                id="payout-amount"
                value={amount}
                onChange={setAmount}
                currencyPrefix={symbol}
                required
              />
            </Field>
            <Field label={t("contributions.datePaid")} htmlFor="payout-date">
              <Input
                id="payout-date"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
          </div>

          <Field label={t("contributions.payee")} htmlFor="payout-payee">
            <Input
              id="payout-payee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              maxLength={160}
              autoComplete="off"
            />
          </Field>

          <Field label={t("contributions.payoutPurpose")} htmlFor="payout-purpose">
            <Textarea
              id="payout-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              maxLength={400}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("contributions.methodLabel")} htmlFor="payout-method">
              <Select
                value={method ?? NONE}
                onValueChange={(next) => setMethod(next === NONE ? null : next)}
              >
                <SelectTrigger id="payout-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("contributions.referenceLabel")} htmlFor="payout-ref">
              <Input
                id="payout-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label={t("contributions.proofLabel")}>
            <ProofField
              value={proof}
              onChange={setProof}
              potId={potId}
              disabled={pending}
              labels={{
                attach: t("contributions.attachProof"),
                attached: t("contributions.proofAttached"),
                hint: t("contributions.proofHint"),
              }}
            />
          </Field>

          {/*
            Posting into Finance is offered only where it is honest: a hand-over
            is the one kind where the money actually arrives in the church's
            books. Everything else stays in the group's hands and would be
            income the church never received.
          */}
          {kind === "handover" && canPostToFinance && financeAccounts.length > 0 && (
            <div className="bg-muted/40 space-y-3 rounded-xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <label
                    htmlFor="payout-post"
                    className="text-sm font-semibold select-none"
                  >
                    {t("contributions.postToFinance")}
                  </label>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t("contributions.postToFinanceBlurb")}
                  </p>
                </div>
                <Switch id="payout-post" checked={post} onCheckedChange={setPost} />
              </div>
              {post && (
                <Field
                  label={t("contributions.financeAccount")}
                  htmlFor="payout-account"
                >
                  <Select
                    value={accountId ?? NONE}
                    onValueChange={(next) =>
                      setAccountId(next === NONE ? null : next)
                    }
                  >
                    <SelectTrigger id="payout-account">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {financeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
          )}

          {approvalsRequired > 1 && (
            <p className="text-muted-foreground text-xs">
              This needs {approvalsRequired} people to approve it before it counts as
              paid out. Recording it counts as the first.
            </p>
          )}

        {error && (
          <p className="text-destructive text-sm font-medium" role="alert">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || amount.trim() === ""}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {editing ? "Save changes" : t("contributions.recordPayout")}
        </Button>
      </DialogFooter>
    </>
  );
}
