import "server-only";
import { applyDiscount, getAnnualFreeMonths, getPlanPrices, getPlans } from "@/lib/pricing";
import { cycleMonths, cycleTotal, type BillingCycle } from "@/lib/billing-cycle";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  priceForCountry,
  pricesForCountry,
  planPriceLabelFor,
  type PlanPrice,
} from "@/lib/plan-price";

/**
 * What a church is offered, and what it is charged — from ONE calculation.
 *
 * Three screens quote a church a price before it pays: the billing page, the
 * trial gate, and Paystack's own checkout. They used to compute it three ways.
 * The gate printed the undiscounted NIGERIAN list price in naira, while the
 * checkout behind its button applied the church's discount, the annual
 * months, and — for a church abroad — the international card fee: a church in
 * Maputo shown "₦10,000/mo" was then asked for ₦13,100, in a currency it does
 * not use, with nothing on the page to say why. The gate is the one screen
 * every unpaid church decides on, and it was the one that was wrong.
 *
 * So the order of operations lives here and nowhere else:
 *
 *     list price → the church's discount → the cycle (a year is N months of
 *     money) → the country (conversion and the card fee, once per payment)
 *
 * `chargeFor` is what startCheckout bills; `priceBook` is what the screens
 * print. Both run the same four steps on the same inputs.
 */

export type PricedChurch = {
  country: string | null | undefined;
  planDiscountPct: number;
};

export type Charge = {
  /** The discounted monthly price, in naira, before the cycle or the fee. */
  monthly: number;
  /** One payment for the cycle, in naira, before the international fee. */
  total: number;
  /** How many months that payment buys. */
  months: number;
  freeMonths: number;
  /** The charge itself, with the fee and the church's own currency. */
  priced: PlanPrice;
};

/**
 * What one checkout for `plan` charges this church. Null for a custom plan.
 */
export async function chargeFor(
  plan: PlanId,
  cycle: BillingCycle,
  c: PricedChurch,
): Promise<Charge | null> {
  const [prices, freeMonths] = await Promise.all([getPlanPrices(), getAnnualFreeMonths()]);
  const monthly = applyDiscount(prices[plan], c.planDiscountPct);
  if (monthly === null) return null;
  const total = cycleTotal(monthly, cycle, freeMonths) ?? 0;
  return {
    monthly,
    total,
    months: cycleMonths(cycle),
    freeMonths,
    priced: await priceForCountry(total, c.country),
  };
}

export type PriceBook = {
  freeMonths: number;
  /** List prices, undiscounted, in naira. */
  basePrices: Record<PlanId, number | null>;
  /** Discounted monthly prices, in naira, before any fee. */
  prices: Record<PlanId, number | null>;
  /** Discounted yearly totals, in naira, before any fee. */
  annualPrices: Record<PlanId, number | null>;
  /** The same four sets of figures, priced for the church's country. */
  local: {
    monthly: Record<string, PlanPrice | null>;
    annual: Record<string, PlanPrice | null>;
    baseMonthly: Record<string, PlanPrice | null>;
    baseAnnual: Record<string, PlanPrice | null>;
  };
  /** Any one international price, for the currency note. Null at home. */
  international: PlanPrice | null;
};

/** Every plan, priced for this church, for a screen to print. */
export async function priceBook(c: PricedChurch): Promise<PriceBook> {
  const [basePrices, freeMonths] = await Promise.all([getPlanPrices(), getAnnualFreeMonths()]);
  const ids = PLANS.map((p) => p.id);
  const map = <T>(f: (id: PlanId) => T) =>
    Object.fromEntries(ids.map((id) => [id, f(id)])) as Record<PlanId, T>;

  const prices = map((id) => applyDiscount(basePrices[id], c.planDiscountPct));
  const annualPrices = map((id) => cycleTotal(prices[id], "annual", freeMonths));
  const baseAnnual = map((id) => cycleTotal(basePrices[id], "annual", freeMonths));

  /*
   * The struck-through "was" price is converted too, and carries the same
   * card fee. A naira list price struck through beside a converted price
   * read as a 92% discount, or as a broken page; priced the same way, the gap
   * between the two figures is the discount and nothing else.
   */
  const [monthly, annual, baseMonthlyLocal, baseAnnualLocal] = await Promise.all([
    pricesForCountry(prices, c.country),
    pricesForCountry(annualPrices, c.country),
    pricesForCountry(basePrices, c.country),
    pricesForCountry(baseAnnual, c.country),
  ]);
  const international =
    Object.values(monthly).find((p) => p?.international) ??
    Object.values(annual).find((p) => p?.international) ??
    null;

  return {
    freeMonths,
    basePrices,
    prices,
    annualPrices,
    local: { monthly, annual, baseMonthly: baseMonthlyLocal, baseAnnual: baseAnnualLocal },
    international,
  };
}

/** "MT 400/mo", "₦5,000/mo", "Free", or null for a custom plan. */
export function offerLabel(p: PlanPrice | null | undefined, per: "/mo" | "/yr"): string | null {
  if (!p) return null;
  return planPriceLabelFor(p, { perMonth: per });
}

/**
 * The sentence under a price list for a church abroad: which money it is
 * quoted in, which money the card is charged in, and the exact fee. Null at
 * home, where there is nothing to explain.
 */
export function currencyNote(intl: PlanPrice | null, opts: { annual: boolean }): string | null {
  if (!intl) return null;
  return [
    `Prices are shown in ${intl.displayCurrency}.`,
    `Your card is charged in Nigerian naira — the total includes ₦${intl.surchargeNgn.toLocaleString()} toward international card fees, which are far higher than local ones.`,
    intl.live
      ? "Converted at today's exchange rate; your bank's rate may differ slightly."
      : "The exchange rate service is unreachable right now, so the converted figure is indicative — the naira amount charged is exact.",
    opts.annual
      ? "That fee is charged once per payment, so paying for the year carries it once rather than twelve times."
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export type GateOffer = {
  id: PlanId;
  name: string;
  tagline: string;
  priceLabel: string;
  annualPriceLabel: string | null;
  /** True when the church pays nothing for it (a 100% discount): "Activate", not "Pay". */
  free: boolean;
};

/**
 * The trial gate's plan list, from the same book as the billing page. Paid
 * tiers only — a tier whose list price is zero is not a decision anybody is
 * being asked to make at the paywall.
 */
export async function gateOffers(c: PricedChurch): Promise<{
  offers: GateOffer[];
  freeMonths: number;
  note: string | null;
}> {
  const [book, catalog] = await Promise.all([priceBook(c), getPlans()]);
  const offers = catalog
    .filter((p) => (book.basePrices[p.id] ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      priceLabel: offerLabel(book.local.monthly[p.id], "/mo") ?? "Custom",
      annualPriceLabel: offerLabel(book.local.annual[p.id], "/yr"),
      free: (book.prices[p.id] ?? 0) === 0,
    }));
  return {
    offers,
    freeMonths: book.freeMonths,
    note: currencyNote(book.international, { annual: book.freeMonths > 0 }),
  };
}
