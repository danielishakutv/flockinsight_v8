"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { type BillingCycle } from "@/lib/billing-cycle";
import { cn } from "@/lib/utils";

/**
 * Monthly or yearly, on a page whose prices were worked out on the server.
 *
 * ## Why it is built this way
 *
 * Every price on the public pages is computed on the server: the plan price
 * comes from the admin settings, the currency from the visitor's country, and
 * the yearly total from a whole number of months. A toggle that multiplied a
 * price in the browser would be a second implementation of the charge, and the
 * first time the two disagreed the church would find out on its statement.
 *
 * So both labels are RENDERED on the server, into this component, and the
 * toggle only chooses which of the two is shown. Nothing here does arithmetic.
 *
 * ## Why a context, with server-rendered cards inside it
 *
 * The toggle sits above the grid and the prices sit inside each card, so they
 * need to share one piece of state. The provider is a client component; the
 * cards are server-rendered and passed through it as children; the price
 * itself is a small client component nested inside them. React composes that
 * tree at runtime, so the context reaches the prices even though a server
 * component sits in between — which is what keeps the cards, their copy and
 * their feature lists out of the JavaScript bundle entirely.
 *
 * Defaults to monthly, deliberately. The yearly figure is the cheaper one per
 * month and the one worth promoting, but a church that sees "₦4,167" first and
 * discovers at checkout that the charge is ₦50,000 has been handled sharply.
 * The saving is advertised on the toggle instead, where it is an offer rather
 * than a surprise.
 */
const CycleContext = createContext<{
  cycle: BillingCycle;
  setCycle: (c: BillingCycle) => void;
} | null>(null);

export function useCycle(): BillingCycle {
  // No provider is a valid state: a page that shows monthly prices only.
  return useContext(CycleContext)?.cycle ?? "monthly";
}

export function PriceCycleProvider({
  children,
  initial = "monthly",
}: {
  children: ReactNode;
  initial?: BillingCycle;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initial);
  return (
    <CycleContext.Provider value={{ cycle, setCycle }}>
      {children}
    </CycleContext.Provider>
  );
}

/**
 * The two buttons, and the badge saying what the right-hand one is worth.
 *
 * `role="radiogroup"` with two radios rather than a switch: a switch has to be
 * read twice to work out which side means what, and this one changes a price.
 */
export function PriceCycleToggle({
  monthlyLabel,
  annualLabel,
  savingLabel,
  className,
}: {
  monthlyLabel: string;
  annualLabel: string;
  /** "2 months free" — already in the visitor's language. */
  savingLabel?: string | null;
  className?: string;
}) {
  const ctx = useContext(CycleContext);
  if (!ctx) return null;
  const { cycle, setCycle } = ctx;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-3",
        className,
      )}
    >
      <div
        role="radiogroup"
        aria-label={`${monthlyLabel} / ${annualLabel}`}
        className="bg-muted inline-flex rounded-full p-1"
      >
        {(
          [
            ["monthly", monthlyLabel],
            ["annual", annualLabel],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={cycle === value}
            onClick={() => setCycle(value)}
            className={cn(
              // 44px tall: the house minimum for a touch target, and this
              // one is the control that decides what a church pays.
              "min-h-11 rounded-full px-5 text-sm font-bold transition",
              cycle === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {savingLabel && (
        <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-bold">
          {savingLabel}
        </span>
      )}
    </div>
  );
}

/**
 * One of two server-rendered price blocks, chosen by the toggle.
 *
 * The monthly one is what the server renders, so a crawler — and a visitor
 * whose JavaScript has not arrived yet on a slow connection — reads a complete
 * monthly price rather than an empty card or a loading state. The yearly one
 * is the same markup with different numbers in it, swapped in on a click.
 */
export function CyclePrice({
  monthly,
  annual,
}: {
  monthly: ReactNode;
  annual: ReactNode;
}) {
  return useCycle() === "annual" ? <>{annual}</> : <>{monthly}</>;
}
