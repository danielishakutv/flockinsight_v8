/**
 * Monthly or yearly, and the arithmetic of the discount. No database, no
 * request, no React — so the checkout action, the pricing page and the
 * Partner ledger all do the same sum.
 *
 * The offer is expressed in MONTHS FREE, not in a percentage, and that is the
 * whole design. "Two months free" is a sentence a pastor can check against
 * their own bank statement: twelve months of service for ten months of money.
 * A percentage cannot be checked — 16.67% of twelve is a number nobody can
 * verify in their head, and the moment it is rounded to 17% the figure on the
 * pricing page stops matching the figure on the invoice. The percentage here
 * exists only as a badge; `annualTotal` is the only thing that decides money,
 * and it is a multiplication of whole naira by a whole number of months.
 *
 * One consequence worth naming: an annual payment is ONE charge, so it carries
 * one international card surcharge rather than twelve. That is handled by
 * passing the annual total through `priceForCountry` once — see the checkout
 * action — and it makes paying annually cheaper again for a church abroad.
 */

export type BillingCycle = "monthly" | "annual";

export const BILLING_CYCLES: BillingCycle[] = ["monthly", "annual"];

export const MONTHS_IN_YEAR = 12;

/** Two months off, which is why the annual price is ten months of money. */
export const DEFAULT_ANNUAL_FREE_MONTHS = 2;

/** Anything that is not one of the two cycles is monthly, never a throw. */
export function asCycle(raw: unknown): BillingCycle {
  return raw === "annual" ? "annual" : "monthly";
}

/**
 * The stored setting, made safe.
 *
 * Clamped to 0–11: twelve free months out of twelve is a free plan arrived at
 * by accident, which is the one typo in this file that could give the product
 * away.
 */
export function normaliseFreeMonths(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_ANNUAL_FREE_MONTHS;
  return Math.min(MONTHS_IN_YEAR - 1, Math.max(0, Math.round(n)));
}

/** How many months of money a year costs. */
export function chargedMonths(freeMonths: number): number {
  return MONTHS_IN_YEAR - normaliseFreeMonths(freeMonths);
}

/** How many months of service one payment buys. */
export function cycleMonths(cycle: BillingCycle): number {
  return cycle === "annual" ? MONTHS_IN_YEAR : 1;
}

/**
 * What one payment comes to, from the monthly list price.
 *
 * `null` stays null: that is Enterprise, which is a conversation rather than a
 * price, and inventing a yearly figure for it would be inventing the monthly
 * one first.
 */
export function cycleTotal(
  monthly: number | null,
  cycle: BillingCycle,
  freeMonths: number,
): number | null {
  if (monthly === null) return null;
  if (cycle !== "annual") return monthly;
  return monthly * chargedMonths(freeMonths);
}

/** The yearly total: ten months of money for twelve months of service. */
export function annualTotal(monthly: number | null, freeMonths: number): number | null {
  return cycleTotal(monthly, "annual", freeMonths);
}

/** What the church keeps by paying for the year, in major units. */
export function annualSaving(monthly: number | null, freeMonths: number): number {
  if (monthly === null || monthly <= 0) return 0;
  return monthly * normaliseFreeMonths(freeMonths);
}

/**
 * The same saving as a percentage, for a badge and nothing else.
 *
 * Never used to compute a charge. Two months in twelve is 16.666…%, and a
 * price derived from a rounded percentage disagrees with a price derived from
 * whole months — which is the kind of ₦1 discrepancy that turns into a
 * question about whether the rest of the bill can be trusted.
 */
export function annualDiscountPct(freeMonths: number): number {
  return Math.round((normaliseFreeMonths(freeMonths) / MONTHS_IN_YEAR) * 100);
}

/**
 * The yearly total written as a monthly figure, for the "works out at" line.
 *
 * Rounded to whole units because every price in this product is a round number
 * and "₦4,166.67/mo" reads like a bank statement rather than a price.
 */
export function monthlyEquivalent(
  monthly: number | null,
  freeMonths: number,
): number | null {
  const total = annualTotal(monthly, freeMonths);
  if (total === null) return null;
  return Math.round(total / MONTHS_IN_YEAR);
}

/** "2 months free" / "1 month free" — the badge, and the honest version of it. */
export function freeMonthsLabel(freeMonths: number): string {
  const n = normaliseFreeMonths(freeMonths);
  return `${n} month${n === 1 ? "" : "s"} free`;
}
