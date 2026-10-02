"use client";

import { AlertTriangle, Check, Clock, PartyPopper, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import {
  progressPct,
  type ContributionStatus,
  type EntryStatus,
  type PayoutStatus,
} from "@/lib/contributions-shared";

/**
 * The small, repeated parts of the contributions screens.
 *
 * They live together because every one of them appears in at least three
 * places — the list, the detail page and the public page — and a status chip
 * that means one thing to the team and another to the congregation would be
 * worse than no chip at all.
 */

/* ============================================================
 * The meter
 * ========================================================== */

/**
 * How far along a collection is, in the one glance a phone gets.
 *
 * Three things are shown rather than one, and the arrangement is the point. The
 * big number is what has been CONFIRMED, because that is the only money anyone
 * can spend. Claims waiting to be confirmed are a lighter band on the same bar
 * rather than a second figure somewhere else — they are the difference between
 * what people say they paid and what has been checked, which is precisely the
 * gap a treasurer is trying to close. And the goal sits at the end, so the
 * remaining distance is a length and not a subtraction.
 */
export function PotMeter({
  raised,
  pending = 0,
  target,
  currency,
  className,
  size = "default",
}: {
  raised: number;
  pending?: number;
  target: number | null;
  currency: string;
  className?: string;
  size?: "default" | "lg";
}) {
  const t = useT();
  const pct = progressPct(raised, target);
  const over = target != null && target > 0 && raised >= target;

  // The pending band starts where the confirmed bar ends and is capped at the
  // track, so a wildly over-reported claim cannot push the bar off the card.
  const pendingPct =
    target && target > 0
      ? Math.max(0, Math.min(100 - (pct ?? 0), Math.round((pending / target) * 100)))
      : 0;

  return (
    <div className={className}>
      <div
        className={cn(
          "bg-muted relative w-full overflow-hidden rounded-full",
          size === "lg" ? "h-3.5" : "h-2.5",
        )}
        role="progressbar"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("contributions.progressLabel")}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
            over ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${pct ?? (raised > 0 ? 100 : 0)}%` }}
        />
        {pendingPct > 0 && (
          <div
            className="bg-primary/30 absolute inset-y-0 rounded-full transition-[width] duration-500"
            style={{ left: `${pct ?? 0}%`, width: `${pendingPct}%` }}
          />
        )}
      </div>
      {target != null && target > 0 && (
        <div className="text-muted-foreground mt-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold tabular-nums">{pct}%</span>
          <span className="tabular-nums">
            {formatMoney(target, currency)} goal
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Statuses
 * ========================================================== */

export function PotStatusBadge({ status }: { status: ContributionStatus }) {
  const map: Record<
    ContributionStatus,
    { label: string; variant: "secondary" | "default" | "outline" | "success" }
  > = {
    draft: { label: "Draft", variant: "secondary" },
    open: { label: "Collecting", variant: "default" },
    closed: { label: "Closed", variant: "outline" },
    settled: { label: "Settled", variant: "success" },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * What one payment's standing is.
 *
 * Deliberately wordy. "Pending" means nothing to somebody opening a WhatsApp
 * link; "Awaiting confirmation" says who is holding it up and implies that it
 * will move. A status nobody can interpret is a status that generates a phone
 * call to the treasurer, which is the thing this feature exists to stop.
 */
export function EntryStatusBadge({
  status,
  short = false,
}: {
  status: EntryStatus;
  short?: boolean;
}) {
  if (status === "confirmed")
    return (
      <Badge variant="success" className="gap-1">
        <Check aria-hidden /> Confirmed
      </Badge>
    );
  if (status === "disputed")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle aria-hidden /> Disputed
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="outline" className="gap-1">
        <XCircle aria-hidden /> Not counted
      </Badge>
    );
  return (
    <Badge variant="warning" className="gap-1">
      <Clock aria-hidden /> {short ? "Awaiting" : "Awaiting confirmation"}
    </Badge>
  );
}

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  if (status === "approved")
    return (
      <Badge variant="success" className="gap-1">
        <Check aria-hidden /> Approved
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="outline" className="gap-1">
        <XCircle aria-hidden /> Rejected
      </Badge>
    );
  return (
    <Badge variant="warning" className="gap-1">
      <Clock aria-hidden /> Awaiting approval
    </Badge>
  );
}

export function GoalReachedBanner({
  target,
  currency,
}: {
  target: number;
  currency: string;
}) {
  const t = useT();
  return (
    <div className="bg-success/10 text-success-foreground border-success/30 flex items-center gap-3 rounded-2xl border p-4">
      <span className="bg-success/20 text-success grid size-10 shrink-0 place-items-center rounded-xl">
        <PartyPopper className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-foreground font-bold">
          {t("contributions.publicGoalReached")}
        </p>
        <p className="text-muted-foreground text-sm">
          {formatMoney(target, currency)} and counting. Thank you, everyone.
        </p>
      </div>
    </div>
  );
}

/* ============================================================
 * Figures
 * ========================================================== */

export function Figure({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "muted" | "warning";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
        {label}
      </p>
      <p
        className={cn(
          "truncate text-xl font-extrabold tabular-nums sm:text-2xl",
          tone === "accent" && "text-primary",
          tone === "muted" && "text-muted-foreground",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted-foreground truncate text-xs">{hint}</p>}
    </div>
  );
}

/* ============================================================
 * Inputs
 * ========================================================== */

/**
 * An amount field that summons a number pad.
 *
 * `inputMode="decimal"` rather than `type="number"`: a number input rejects the
 * grouped "5,000" people type out of habit, silently drops the value on some
 * Android keyboards, and puts spinner arrows next to a figure where a mis-click
 * changes money. `parseAmount` handles the commas instead.
 */
export function MoneyInput({
  id,
  name,
  value,
  onChange,
  currencyPrefix,
  placeholder = "0",
  required,
  disabled,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (next: string) => void;
  currencyPrefix?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {currencyPrefix && (
        <span
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold"
        >
          {currencyPrefix}
        </span>
      )}
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy}
        className={cn("tabular-nums", currencyPrefix && "pl-9")}
      />
    </div>
  );
}

/** A labelled row inside a dialog, so every form in the module lines up. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-sm leading-none font-semibold select-none"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && <p className="text-destructive text-xs font-medium">{error}</p>}
    </div>
  );
}
