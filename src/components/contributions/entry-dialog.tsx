"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { recordEntry, type EntryInput } from "@/app/(app)/contributions/actions";
import type { ContributorRow, EntryRow } from "@/lib/contributions";
import { METHOD_LABEL, nameKey } from "@/lib/contributions-shared";
import { currencySymbol } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const METHODS = ["cash", "transfer", "card", "cheque", "online", "other"] as const;
const NONE = "__none__";

/**
 * Recording one payment.
 *
 * The person field is a free-text box with suggestions rather than a dropdown,
 * and that is the difference between this being usable on a Sunday and not. A
 * leader counting cash has a name in their head; a dropdown forces them to
 * decide first whether that person is on the roster, on the register, or new —
 * three different places to look before they can type a figure. Here they type
 * the name. If it matches somebody already on the list, the payment attaches to
 * them; if not, the person is added. Both outcomes are correct, and neither
 * needs a decision.
 */
export function EntryDialog({
  open,
  onOpenChange,
  potId,
  currency,
  today,
  contributors,
  members,
  askForProof,
  editing,
  /** Pre-select a person, when recording from their row. */
  presetContributorId,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  today: string;
  contributors: ContributorRow[];
  members: { id: string; name: string }[];
  askForProof: boolean;
  editing?: EntryRow | null;
  presetContributorId?: string | null;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("contributions.editPayment") : t("contributions.recordPayment")}
          </DialogTitle>
        </DialogHeader>
        {/*
          The form is a child, and that is load-bearing rather than tidiness.
          Radix mounts this content only while the dialog is open, so the form's
          state is BORN fresh every time instead of being reset by an effect —
          which is how a quick-entry dialog reopened after a save used to be
          holding the last person's amount, and how it silently recorded the
          wrong figure against the wrong name.
        */}
        <EntryForm
          onOpenChange={onOpenChange}
          potId={potId}
          currency={currency}
          today={today}
          contributors={contributors}
          members={members}
          askForProof={askForProof}
          editing={editing}
          presetContributorId={presetContributorId}
        />
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  onOpenChange,
  potId,
  currency,
  today,
  contributors,
  members,
  askForProof,
  editing,
  presetContributorId,
}: {
  onOpenChange: (next: boolean) => void;
  potId: string;
  currency: string;
  today: string;
  contributors: ContributorRow[];
  members: { id: string; name: string }[];
  askForProof: boolean;
  editing?: EntryRow | null;
  presetContributorId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const preset =
    !editing && presetContributorId
      ? contributors.find((c) => c.id === presetContributorId)
      : null;

  const [who, setWho] = useState(editing?.contributorName ?? preset?.name ?? "");
  const [contributorId, setContributorId] = useState<string | null>(
    editing?.contributorId ?? preset?.id ?? null,
  );
  const [memberId, setMemberId] = useState<string | null>(null);
  const [amount, setAmount] = useState(
    editing
      ? String(editing.amount)
      : // Pre-filling what they still owe is right far more often than not, and
        // it is the figure a leader is about to type anyway.
        preset?.outstanding && preset.outstanding > 0
        ? String(preset.outstanding)
        : "",
  );
  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? today);
  const [method, setMethod] = useState<string | null>(editing?.method ?? "cash");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [proof, setProof] = useState<ProofValue>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Who the typed name is going to attach to.
   *
   * Shown back to the person typing, because the alternative is finding out
   * after the fact that "Grace" went onto a third Grace. Roster first (they are
   * already in this collection), then the register.
   */
  const resolution = useMemo(() => {
    if (contributorId) {
      const c = contributors.find((x) => x.id === contributorId);
      return c ? { kind: "roster" as const, label: c.name } : null;
    }
    const key = nameKey(who);
    if (!key) return null;
    const onRoster = contributors.find((c) => nameKey(c.name) === key);
    if (onRoster) return { kind: "roster" as const, label: onRoster.name };
    const onRegister = members.find((m) => nameKey(m.name) === key);
    if (onRegister) return { kind: "register" as const, label: onRegister.name };
    return { kind: "new" as const, label: who.trim() };
  }, [who, contributorId, contributors, members]);

  const suggestions = useMemo(() => {
    const q = who.trim().toLowerCase();
    if (q.length < 2 || contributorId) return [];
    const pool = [
      ...contributors.map((c) => ({
        id: c.id,
        name: c.name,
        kind: "roster" as const,
        outstanding: c.outstanding,
      })),
      ...members
        // Somebody already on the roster is not offered twice.
        .filter((m) => !contributors.some((c) => c.memberId === m.id))
        .map((m) => ({
          id: m.id,
          name: m.name,
          kind: "register" as const,
          outstanding: 0,
        })),
    ];
    return pool.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [who, contributorId, contributors, members]);

  function submit() {
    setError(null);
    const payload: EntryInput = {
      id: editing?.id,
      contributionId: potId,
      contributorId,
      contributorName: contributorId ? null : who,
      memberId,
      phone: null,
      amount,
      method,
      paidOn,
      reference,
      note,
      proofMediaId: proof?.mediaId ?? null,
    };
    start(async () => {
      const res = await recordEntry(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("contributions.savedPayment"));
      onOpenChange(false);
      router.refresh();
    });
  }

  const symbol = currencySymbol(currency);
  const canSubmit = (contributorId || who.trim().length >= 2) && amount.trim() !== "";

  return (
    <>
      <div className="space-y-4">
          <Field label={t("contributions.whoPaid")} htmlFor="entry-who">
            <Input
              id="entry-who"
              value={who}
              onChange={(e) => {
                setWho(e.target.value);
                setContributorId(null);
                setMemberId(null);
              }}
              placeholder={t("contributions.whoPaidPlaceholder")}
              autoComplete="off"
              maxLength={160}
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="bg-card mt-1 overflow-hidden rounded-xl border">
                {suggestions.map((s) => (
                  <li key={`${s.kind}-${s.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setWho(s.name);
                        if (s.kind === "roster") {
                          setContributorId(s.id);
                          setMemberId(null);
                        } else {
                          setContributorId(null);
                          setMemberId(s.id);
                        }
                        if (s.kind === "roster" && s.outstanding > 0 && !amount)
                          setAmount(String(s.outstanding));
                      }}
                      className="hover:bg-accent flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm"
                    >
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {s.kind === "roster" ? "on this list" : "a member"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {resolution?.kind === "new" && (
              <p className="text-muted-foreground mt-1 text-xs">
                New name — {resolution.label} will be added to this collection.
              </p>
            )}
            {resolution?.kind === "register" && (
              <p className="text-muted-foreground mt-1 text-xs">
                {resolution.label} will be added to this collection from your register.
              </p>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("contributions.amountPaid")} htmlFor="entry-amount">
              <MoneyInput
                id="entry-amount"
                value={amount}
                onChange={setAmount}
                currencyPrefix={symbol}
                required
              />
            </Field>
            <Field label={t("contributions.datePaid")} htmlFor="entry-date">
              <Input
                id="entry-date"
                type="date"
                value={paidOn}
                max={today}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("contributions.methodLabel")} htmlFor="entry-method">
              <Select
                value={method ?? NONE}
                onValueChange={(next) => setMethod(next === NONE ? null : next)}
              >
                <SelectTrigger id="entry-method">
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
            <Field label={t("contributions.referenceLabel")} htmlFor="entry-ref">
              <Input
                id="entry-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("contributions.referencePlaceholder")}
                maxLength={120}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label={t("contributions.noteLabel")} htmlFor="entry-note">
            <Textarea
              id="entry-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("contributions.notePlaceholder")}
              rows={2}
              maxLength={500}
            />
          </Field>

          {askForProof && (
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
        <Button onClick={submit} disabled={pending || !canSubmit}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {editing ? "Save changes" : t("contributions.recordPayment")}
        </Button>
      </DialogFooter>
    </>
  );
}
