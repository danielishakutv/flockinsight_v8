import "server-only";
import {
  applyDiscount,
  customPlanBullets,
  getAnnualFreeMonths,
  getPlanPrices,
  getPlans,
} from "@/lib/pricing";
import { cycleMonths, cycleTotal, type BillingCycle } from "@/lib/billing-cycle";
import { customPlanKey, parsePlanKey, type Plan } from "@/lib/plans";
import type { EntitlementCatalog } from "@/lib/entitlements";
import {
  getCustomPlan,
  listCustomPlans,
  loadCatalog,
  type CustomPlanRow,
} from "@/lib/plan-catalog";
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
 * A plan a church can be offered: a tier, or a custom plan made at
 * /superadmin/plans. `key` is what checkout is asked for ("growth",
 * "custom:<id>"); `priceMonthly` is the list price before the church's
 * discount, null for "contact us".
 */
export type OfferPlan = {
  key: string;
  name: string;
  tagline: string;
  features: string[];
  priceMonthly: number | null;
  custom: boolean;
  highlight?: boolean;
};

/** The four tiers, as offers. No database: tests price these alone. */
export async function tierOffers(): Promise<OfferPlan[]> {
  return (await getPlans()).map((p) => ({
    key: p.id,
    name: p.name,
    tagline: p.tagline,
    features: p.features,
    priceMonthly: p.priceMonthly,
    custom: false,
    highlight: p.highlight,
  }));
}

/**
 * Everything this church may choose: the tiers, every custom plan on the
 * website, and the custom plan the church is on now even if it is not on the
 * website or has been archived — a church must always be able to renew the
 * plan it has.
 */
export async function offerPlans(c: { customPlanId: string | null }): Promise<OfferPlan[]> {
  const [tiers, customs] = await Promise.all([tierOffers(), websiteCustomPlans()]);
  const shown = customs.filter((p) => p.key !== customPlanKey(c.customPlanId ?? ""));
  const current = c.customPlanId ? await customOffer(c.customPlanId) : null;
  return [...tiers, ...shown, ...(current ? [current] : [])];
}

/** The custom plans churches can see and buy: on the website, not archived. */
export async function websiteCustomPlans(): Promise<OfferPlan[]> {
  const [rows, catalog] = await Promise.all([listCustomPlans(), loadCatalog()]);
  return rows.filter((r) => r.showOnWebsite).map((r) => toOffer(r, catalog));
}

/**
 * What the public pricing and home pages list: the four tiers, then each
 * custom plan ticked "Show on the website", in the shape those pages already
 * render. `id` is a plan key, which is all the pages use it for.
 */
export type WebsitePlan = Omit<Plan, "id"> & { id: string; custom: boolean };

export async function getWebsitePlans(): Promise<WebsitePlan[]> {
  const [tiers, rows, catalog] = await Promise.all([
    getPlans(),
    listCustomPlans(),
    loadCatalog(),
  ]);
  return [
    ...tiers.map((p) => ({ ...p, custom: false })),
    ...rows
      .filter((r) => r.showOnWebsite)
      .map((r) => ({
        id: customPlanKey(r.id),
        name: r.name,
        tagline: r.tagline,
        priceMonthly: r.priceMonthly,
        memberLimit: r.memberLimit,
        emailAllowance: r.emailAllowance,
        features: customPlanBullets(r, catalog.custom[r.id]?.features ?? []),
        custom: true,
      })),
  ];
}

async function customOffer(id: string): Promise<OfferPlan | null> {
  const [row, catalog] = await Promise.all([getCustomPlan(id), loadCatalog()]);
  return row ? toOffer(row, catalog) : null;
}

function toOffer(row: CustomPlanRow, catalog: EntitlementCatalog): OfferPlan {
  return {
    key: customPlanKey(row.id),
    name: row.name,
    tagline: row.tagline,
    features: customPlanBullets(row, catalog.custom[row.id]?.features ?? []),
    priceMonthly: row.priceMonthly,
    custom: true,
  };
}

/** A key's list price in naira a month. Null = contact us, or no such plan. */
async function listPrice(key: string): Promise<number | null> {
  const parsed = parsePlanKey(key);
  if (!parsed) return null;
  if ("tier" in parsed) return (await getPlanPrices())[parsed.tier];
  return (await getCustomPlan(parsed.customId))?.priceMonthly ?? null;
}

/**
 * What one checkout for `plan` charges this church. Null for a plan with no
 * price (Enterprise, a custom plan marked "contact us").
 */
export async function chargeFor(
  plan: string,
  cycle: BillingCycle,
  c: PricedChurch,
): Promise<Charge | null> {
  const [list, freeMonths] = await Promise.all([listPrice(plan), getAnnualFreeMonths()]);
  const monthly = applyDiscount(list, c.planDiscountPct);
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
  /** List prices, undiscounted, in naira — by plan key. */
  basePrices: Record<string, number | null>;
  /** Discounted monthly prices, in naira, before any fee. */
  prices: Record<string, number | null>;
  /** Discounted yearly totals, in naira, before any fee. */
  annualPrices: Record<string, number | null>;
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

/**
 * Every plan offered, priced for this church, for a screen to print.
 *
 * The list prices come from the offers themselves (`offerPlans`), which read
 * them where checkout does — the pricing page for a tier, the plan's own row
 * for a custom plan.
 */
export async function priceBook(
  c: PricedChurch,
  plans: ReadonlyArray<Pick<OfferPlan, "key" | "priceMonthly">>,
): Promise<PriceBook> {
  const freeMonths = await getAnnualFreeMonths();
  const basePrices = Object.fromEntries(plans.map((p) => [p.key, p.priceMonthly]));
  const map = <T>(f: (key: string) => T) =>
    Object.fromEntries(plans.map((p) => [p.key, f(p.key)])) as Record<string, T>;

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
  /** A plan key: "growth", or "custom:<id>". */
  id: string;
  name: string;
  tagline: string;
  priceLabel: string;
  annualPriceLabel: string | null;
  /** True when the church pays nothing for it (a 100% discount): "Activate", not "Pay". */
  free: boolean;
};

/**
 * The trial gate's plan list, from the same book as the billing page. Paid
 * plans only — one whose list price is zero is not a decision anybody is
 * being asked to make at the paywall.
 */
export async function gateOffers(
  c: PricedChurch,
  plans: OfferPlan[],
): Promise<{
  offers: GateOffer[];
  freeMonths: number;
  note: string | null;
}> {
  const book = await priceBook(c, plans);
  const offers = plans
    .filter((p) => (book.basePrices[p.key] ?? 0) > 0)
    .map((p) => ({
      id: p.key,
      name: p.name,
      tagline: p.tagline,
      priceLabel: offerLabel(book.local.monthly[p.key], "/mo") ?? "Custom",
      annualPriceLabel: offerLabel(book.local.annual[p.key], "/yr"),
      free: (book.prices[p.key] ?? 0) === 0,
    }));
  return {
    offers,
    freeMonths: book.freeMonths,
    note: currencyNote(book.international, { annual: book.freeMonths > 0 }),
  };
}
