"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveContribution, type PotInput } from "@/app/(app)/contributions/actions";
import {
  CONTRIBUTION_KINDS,
  VISIBILITY_OPTIONS,
  type ContributionKind,
  type ContributionVisibility,
} from "@/lib/contributions-shared";
import { currencySymbol } from "@/lib/money";
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
import { useT } from "@/components/i18n-provider";

const NONE = "__none__";

export type PotFormValues = {
  id?: string;
  title: string;
  purpose: string;
  kind: ContributionKind;
  groupId: string | null;
  targetAmount: string;
  perPersonAmount: string;
  payInstructions: string;
  honoureeMemberId: string | null;
  honoureeName: string;
  startDate: string;
  dueDate: string;
  visibility: ContributionVisibility;
  showOutstanding: boolean;
  showPayouts: boolean;
  showNotes: boolean;
  hideNames: boolean;
  allowSelfReport: boolean;
  askForProof: boolean;
  confirmationsRequired: number;
  payoutApprovalsRequired: number;
  keepProofs: boolean;
};

export function blankPot(today: string): PotFormValues {
  return {
    title: "",
    purpose: "",
    kind: "open",
    groupId: null,
    targetAmount: "",
    perPersonAmount: "",
    payInstructions: "",
    honoureeMemberId: null,
    honoureeName: "",
    startDate: today,
    dueDate: "",
    visibility: "detailed",
    showOutstanding: false,
    showPayouts: true,
    showNotes: true,
    hideNames: false,
    allowSelfReport: true,
    askForProof: true,
    confirmationsRequired: 1,
    payoutApprovalsRequired: 2,
    keepProofs: false,
  };
}

/**
 * Starting or editing a collection.
 *
 * The form is in three parts, and the order is the whole design. First: what
 * are you collecting for, in the words somebody would use out loud. Then: who
 * sees what. Last, and collapsed: the checks.
 *
 * That last decision is the one worth defending. Dual confirmation and
 * approval thresholds are the most *valuable* thing here and the most certain
 * to make a layperson abandon the form if they meet it on line four. So the
 * defaults are already right for the ordinary case — one confirmation in, two
 * approvals out — and the section stays shut until somebody goes looking. A
 * control nobody can find is useless; a control everybody has to understand
 * before they can collect 2,000 naira is worse, because they go back to the
 * notebook and then there are no controls at all.
 */
export function PotFormDialog({
  open,
  onOpenChange,
  initial,
  currency,
  groups,
  members,
  /** Groups this person leads — the only ones they may collect for without the permission. */
  restrictToGroupIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initial: PotFormValues;
  currency: string;
  groups: { id: string; name: string; type: string }[];
  members: { id: string; name: string }[];
  restrictToGroupIds?: string[] | null;
  onSaved?: (id: string, slug: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<PotFormValues>(initial);
  const [showChecks, setShowChecks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = !!initial.id;
  const symbol = currencySymbol(currency);
  const allowedGroups =
    restrictToGroupIds && restrictToGroupIds.length > 0
      ? groups.filter((g) => restrictToGroupIds.includes(g.id))
      : groups;
  const groupRequired = !!restrictToGroupIds && restrictToGroupIds.length > 0;

  function set<K extends keyof PotFormValues>(key: K, value: PotFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    const payload: PotInput = {
      id: v.id,
      title: v.title,
      purpose: v.purpose,
      kind: v.kind,
      groupId: v.groupId,
      targetAmount: v.targetAmount,
      perPersonAmount: v.perPersonAmount,
      payInstructions: v.payInstructions,
      honoureeMemberId: v.honoureeMemberId,
      honoureeName: v.honoureeName,
      startDate: v.startDate,
      dueDate: v.dueDate,
      visibility: v.visibility,
      showOutstanding: v.showOutstanding,
      showPayouts: v.showPayouts,
      showNotes: v.showNotes,
      hideNames: v.hideNames,
      allowSelfReport: v.allowSelfReport,
      askForProof: v.askForProof,
      confirmationsRequired: v.confirmationsRequired,
      payoutApprovalsRequired: v.payoutApprovalsRequired,
      keepProofs: v.keepProofs,
    };
    start(async () => {
      const res = await saveContribution(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("contributions.saved"));
      onOpenChange(false);
      onSaved?.(res.id, res.slug);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? v.title || t("contributions.newOne") : t("contributions.newOne")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---------- 1. What kind ---------- */}
          {!editing && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("contributions.formTitle")}</p>
              <div className="grid gap-2">
                {CONTRIBUTION_KINDS.map((k) => {
                  const picked = v.kind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => set("kind", k.id)}
                      aria-pressed={picked}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                        picked
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent/50",
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
                          {t(
                            k.id === "equal"
                              ? "contributions.kindEqual"
                              : k.id === "open"
                                ? "contributions.kindOpen"
                                : "contributions.kindGift",
                          )}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {t(
                            k.id === "equal"
                              ? "contributions.kindEqualBlurb"
                              : k.id === "open"
                                ? "contributions.kindOpenBlurb"
                                : "contributions.kindGiftBlurb",
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---------- 2. The basics ---------- */}
          <Field label={t("contributions.titleLabel")} htmlFor="pot-title">
            <Input
              id="pot-title"
              value={v.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t("contributions.titlePlaceholder")}
              maxLength={140}
              autoFocus={!editing}
            />
          </Field>

          {v.kind === "gift" && (
            <Field label={t("contributions.honoureeLabel")} htmlFor="pot-honouree">
              <Select
                value={v.honoureeMemberId ?? NONE}
                onValueChange={(next) =>
                  set("honoureeMemberId", next === NONE ? null : next)
                }
              >
                <SelectTrigger id="pot-honouree">
                  <SelectValue placeholder={t("contributions.honoureeOther")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("contributions.honoureeOther")}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!v.honoureeMemberId && (
                <Input
                  value={v.honoureeName}
                  onChange={(e) => set("honoureeName", e.target.value)}
                  placeholder={t("contributions.nameLabel")}
                  maxLength={160}
                  className="mt-2"
                />
              )}
            </Field>
          )}

          <Field label={t("contributions.purposeLabel")} htmlFor="pot-purpose">
            <Textarea
              id="pot-purpose"
              value={v.purpose}
              onChange={(e) => set("purpose", e.target.value)}
              placeholder={t("contributions.purposePlaceholder")}
              rows={3}
              maxLength={2000}
            />
          </Field>

          <Field
            label={t("contributions.groupLabel")}
            htmlFor="pot-group"
            error={
              groupRequired && !v.groupId ? t("contributions.pickYourGroup") : null
            }
          >
            <Select
              value={v.groupId ?? NONE}
              onValueChange={(next) => set("groupId", next === NONE ? null : next)}
            >
              <SelectTrigger id="pot-group">
                <SelectValue placeholder={t("contributions.groupNone")} />
              </SelectTrigger>
              <SelectContent>
                {!groupRequired && (
                  <SelectItem value={NONE}>{t("contributions.groupNone")}</SelectItem>
                )}
                {allowedGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {/*
              Which amount is asked for first follows the kind. On an equal-shares
              levy the per-person figure is the only one anybody knows — the goal
              is arithmetic, and is worked out from the roster if it is left blank.
            */}
            {v.kind === "equal" ? (
              <>
                <Field
                  label={t("contributions.perPersonLabel")}
                  htmlFor="pot-per-person"
                >
                  <MoneyInput
                    id="pot-per-person"
                    value={v.perPersonAmount}
                    onChange={(next) => set("perPersonAmount", next)}
                    currencyPrefix={symbol}
                  />
                </Field>
                <Field
                  label={t("contributions.targetLabel")}
                  htmlFor="pot-target"
                  hint={t("contributions.targetFromListHint")}
                >
                  <MoneyInput
                    id="pot-target"
                    value={v.targetAmount}
                    onChange={(next) => set("targetAmount", next)}
                    currencyPrefix={symbol}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("contributions.targetLabel")} htmlFor="pot-target">
                  <MoneyInput
                    id="pot-target"
                    value={v.targetAmount}
                    onChange={(next) => set("targetAmount", next)}
                    currencyPrefix={symbol}
                  />
                </Field>
                <Field
                  label={t("contributions.perPersonLabel")}
                  htmlFor="pot-per-person"
                  hint={t("contributions.perPersonOptionalHint")}
                >
                  <MoneyInput
                    id="pot-per-person"
                    value={v.perPersonAmount}
                    onChange={(next) => set("perPersonAmount", next)}
                    currencyPrefix={symbol}
                  />
                </Field>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("contributions.startLabel")} htmlFor="pot-start">
              <Input
                id="pot-start"
                type="date"
                value={v.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field label={t("contributions.dueLabel")} htmlFor="pot-due">
              <Input
                id="pot-due"
                type="date"
                value={v.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </Field>
          </div>

          <Field label={t("contributions.payLabel")} htmlFor="pot-pay">
            <Textarea
              id="pot-pay"
              value={v.payInstructions}
              onChange={(e) => set("payInstructions", e.target.value)}
              placeholder={t("contributions.payPlaceholder")}
              rows={2}
              maxLength={600}
            />
          </Field>

          {/* ---------- 3. The link ---------- */}
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-semibold">{t("contributions.linkTitle")}</p>
            <div className="grid gap-2">
              {VISIBILITY_OPTIONS.map((o) => {
                const picked = v.visibility === o.id;
                const labelKey =
                  o.id === "detailed"
                    ? "contributions.visibilityDetailed"
                    : o.id === "summary"
                      ? "contributions.visibilitySummary"
                      : "contributions.visibilityPrivate";
                const blurbKey =
                  o.id === "detailed"
                    ? "contributions.visibilityDetailedBlurb"
                    : o.id === "summary"
                      ? "contributions.visibilitySummaryBlurb"
                      : "contributions.visibilityPrivateBlurb";
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => set("visibility", o.id)}
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
                      <span className="block text-sm font-semibold">{t(labelKey)}</span>
                      <span className="text-muted-foreground block text-xs">
                        {t(blurbKey)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {v.visibility !== "private" && (
              <div className="space-y-3 pt-1">
                <Toggle
                  label={t("contributions.showPayouts")}
                  hint={t("contributions.showPayoutsBlurb")}
                  checked={v.showPayouts}
                  onChange={(next) => set("showPayouts", next)}
                  id="pot-show-payouts"
                />
                <Toggle
                  label={t("contributions.allowSelfReport")}
                  hint={t("contributions.allowSelfReportBlurb")}
                  checked={v.allowSelfReport}
                  onChange={(next) => set("allowSelfReport", next)}
                  id="pot-self-report"
                />
                {v.allowSelfReport && (
                  <Toggle
                    label={t("contributions.askForProof")}
                    hint={t("contributions.askForProofBlurb")}
                    checked={v.askForProof}
                    onChange={(next) => set("askForProof", next)}
                    id="pot-ask-proof"
                  />
                )}
                {v.visibility === "detailed" && (
                  <>
                    <Toggle
                      label={t("contributions.showNotes")}
                      checked={v.showNotes}
                      onChange={(next) => set("showNotes", next)}
                      id="pot-show-notes"
                    />
                    {/*
                      Only offered at `detailed`, because it is the only
                      visibility that publishes a name at all — on `summary`
                      there is no list to take the names off.
                    */}
                    <Toggle
                      label={t("contributions.hideNames")}
                      hint={t("contributions.hideNamesBlurb")}
                      checked={v.hideNames}
                      onChange={(next) => set("hideNames", next)}
                      id="pot-hide-names"
                    />
                  </>
                )}
                <Toggle
                  label={t("contributions.showOutstanding")}
                  hint={t("contributions.showOutstandingBlurb")}
                  checked={v.showOutstanding}
                  onChange={(next) => set("showOutstanding", next)}
                  id="pot-show-outstanding"
                />
              </div>
            )}
          </div>

          {/* ---------- 4. The checks, folded away ---------- */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowChecks((s) => !s)}
              aria-expanded={showChecks}
              className="text-primary flex min-h-11 items-center text-sm font-semibold hover:underline"
            >
              {showChecks
                ? t("contributions.hideChecks")
                : t("contributions.showChecks")}
            </button>
            {showChecks && (
              <div className="mt-3 space-y-4">
                <Field
                  label={t("contributions.confirmationsRequired")}
                  htmlFor="pot-confirmations"
                  hint={t("contributions.confirmationsBlurb")}
                >
                  <Select
                    value={String(v.confirmationsRequired)}
                    onValueChange={(next) =>
                      set("confirmationsRequired", Number(next))
                    }
                  >
                    <SelectTrigger id="pot-confirmations">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 1 ? "1 person" : `${n} people`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={t("contributions.payoutApprovals")}
                  htmlFor="pot-approvals"
                  hint={t("contributions.payoutApprovalsBlurb")}
                >
                  <Select
                    value={String(v.payoutApprovalsRequired)}
                    onValueChange={(next) =>
                      set("payoutApprovalsRequired", Number(next))
                    }
                  >
                    <SelectTrigger id="pot-approvals">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 1 ? "1 person" : `${n} people`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Toggle
                  label={t("contributions.keepProofs")}
                  hint={t("contributions.keepProofsBlurb")}
                  checked={v.keepProofs}
                  onChange={(next) => set("keepProofs", next)}
                  id="pot-keep-proofs"
                />
              </div>
            )}
          </div>

          {error && (
            <p className="text-destructive text-sm font-medium" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || v.title.trim().length < 2}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {editing ? t("common.saveChanges") : t("contributions.newOne")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold select-none">
          {label}
        </label>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
