"use client";

import { formatMoney } from "@/lib/money";
import { parseMoneyInput, type MoneyParseOptions } from "@/lib/money-input";
import { cn } from "@/lib/utils";

/**
 * What an amount field will actually save, drawn under the field as it is typed.
 *
 * A treasurer on a Portuguese or French phone types "1500,50" because the comma
 * is the only decimal key the keypad has. That used to be saved as 150050 with
 * nothing on screen to say so. The preview is computed by the same parser the
 * server action runs (lib/money-input), so "= MT 1,500.50" here is a promise,
 * and a figure the parser cannot read one way only says why BEFORE Save is
 * pressed rather than after.
 *
 * Shown only once something has been typed, and only when the typed text is
 * not already exactly the figure (a bare "5000" needs no echo). Written as
 * "= amount" rather than a sentence, so it reads the same in every language
 * the app speaks.
 */
export function AmountPreview({
  value,
  currency,
  options,
  id,
  className,
}: {
  value: string;
  currency: string;
  options?: MoneyParseOptions;
  id?: string;
  className?: string;
}) {
  const raw = value.trim();
  if (!raw) return null;
  const r = parseMoneyInput(raw, options);
  if (!r.ok) {
    return (
      <p id={id} role="alert" className={cn("text-destructive text-xs font-medium", className)}>
        {r.error}
      </p>
    );
  }
  // Nothing was interpreted: digits only. Echoing them back is noise.
  if (/^\d+$/.test(raw)) return null;
  return (
    <p id={id} aria-live="polite" className={cn("text-muted-foreground text-xs tabular-nums", className)}>
      = {formatMoney(r.value, currency)}
    </p>
  );
}

/** True when the field holds something the server will refuse. */
export function amountProblem(value: string, options?: MoneyParseOptions): string | null {
  const r = parseMoneyInput(value, options);
  return r.ok ? null : r.error;
}
