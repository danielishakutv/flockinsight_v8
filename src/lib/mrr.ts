import { computeStanding } from "@/lib/trial";

/**
 * What one church is worth per month, for MRR. Pure, so the rule is tested
 * rather than trusted.
 *
 * The dashboard used to sum the LIST price of every church's plan over every
 * church that was not suspended. Every signup starts on Starter during a free
 * trial, so a hundred trial churches showed ₦500,000 of monthly revenue that
 * nobody was paying — and the figure was written into the daily snapshot, so
 * the history was wrong too. It also counted lapsed and comped churches at
 * full price, ignored discounts, and counted an annual payer as twelve full
 * months when a year costs fewer.
 *
 * So a church counts only while it is PAID UP (computeStanding says "paid":
 * not trialing, not comped, not lapsed), and at what it actually pays:
 *
 *   - its latest successful payment for its current plan, spread over the
 *     months that payment bought (an annual payment counts a twelfth), less
 *     the international card fee, which passes straight to the card network;
 *   - failing that (a plan set by hand, no payment row), the discounted list
 *     price.
 */

export type MrrChurch = {
  plan: string;
  discountPct: number | null;
  paymentWaived?: boolean | null;
  paymentWaivedUntil?: Date | string | null;
  trialEndsAt?: Date | string | null;
  planRenewsAt?: Date | string | null;
  status?: string | null;
};

export type MrrPayment = {
  plan: string;
  amount: number;
  /** The non-revenue part: international card fee and its rounding. */
  surchargeAmount?: number | null;
  periodMonths: number;
};

export function churchMrr(
  c: MrrChurch,
  latest: MrrPayment | null,
  listPrices: Record<string, number | null>,
  now: Date = new Date(),
): number {
  if (c.status === "suspended") return 0;
  if (computeStanding(c, now).state !== "paid") return 0;

  if (latest && latest.plan === c.plan && latest.amount > 0) {
    const revenue = Math.max(0, latest.amount - Math.max(0, latest.surchargeAmount ?? 0));
    return Math.round(revenue / Math.max(1, latest.periodMonths));
  }

  const list = listPrices[c.plan];
  if (typeof list !== "number" || list <= 0) return 0;
  const pct = Math.min(100, Math.max(0, Math.round(c.discountPct ?? 0)));
  return Math.round(list * (1 - pct / 100));
}
