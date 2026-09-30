import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { countryFromIso2, currencyForCountry } from "@/lib/country-profile";
import { currencySymbol } from "@/lib/money";
import { getRates, internationalPrice } from "@/lib/fx";

/**
 * What a plan costs the church looking at it.
 *
 * Everything upstream of here prices in naira, because naira is what Paystack
 * settles in. This is the one place that answers the other two questions a
 * church outside Nigeria has: what does that come to in my money, and why is
 * it more than the number on the Nigerian page.
 *
 * Kept apart from `fx.ts` on purpose. `fx.ts` is arithmetic and is tested as
 * arithmetic; this reaches for the request, the rate cache and the plan table,
 * and is the only thing that decides whether a given church is "international"
 * at all.
 */

/** A Nigerian church pays the list price. Anyone else carries the card fee. */
function isDomestic(country: string | null | undefined): boolean {
  return !country || country.trim() === "Nigeria";
}

export type PlanPrice = {
  /** What Paystack is actually charged, in naira. Always the number to bill. */
  chargeNgn: number;
  /** The list price before any surcharge, in naira. */
  baseNgn: number;
  /** The surcharge portion, in naira. Zero for a Nigerian church. */
  surchargeNgn: number;
  /** The same total in the church's own currency, for display. */
  displayAmount: number;
  displayCurrency: string;
  /** True when a surcharge and a conversion were applied. */
  international: boolean;
  /** False when the conversion used the stale fallback table. */
  live: boolean;
};

/** A domestic price: no conversion, no surcharge, nothing to explain. */
function domestic(baseNgn: number): PlanPrice {
  return {
    chargeNgn: baseNgn,
    baseNgn,
    surchargeNgn: 0,
    displayAmount: baseNgn,
    displayCurrency: "NGN",
    international: false,
    live: true,
  };
}

/**
 * Price one plan for one country.
 *
 * Free plans stay free everywhere: a surcharge exists to cover a card fee, and
 * there is no card. Charging ₦5,000 for a zero-naira plan because a floor said
 * so would be the single most absurd thing this file could do.
 */
export async function priceForCountry(
  baseNgn: number,
  country: string | null | undefined,
): Promise<PlanPrice> {
  if (baseNgn <= 0 || isDomestic(country)) return domestic(baseNgn);

  const rates = await getRates();
  const intl = internationalPrice(baseNgn, currencyForCountry(country), rates);
  return { ...intl, baseNgn, international: true };
}

/**
 * Price every plan at once.
 *
 * One rate fetch for the whole page: `getRates` is cached, but a pricing table
 * asking four times still reads four times through the cache for no reason.
 * `null` is a custom plan and stays null.
 */
export async function pricesForCountry(
  base: Record<string, number | null>,
  country: string | null | undefined,
): Promise<Record<string, PlanPrice | null>> {
  const domesticOnly = isDomestic(country);
  const rates = domesticOnly ? null : await getRates();
  const currency = domesticOnly ? "NGN" : currencyForCountry(country);

  const out: Record<string, PlanPrice | null> = {};
  for (const [id, amount] of Object.entries(base)) {
    if (amount === null) {
      out[id] = null;
    } else if (amount <= 0 || !rates) {
      out[id] = domestic(amount);
    } else {
      out[id] = {
        ...internationalPrice(amount, currency, rates),
        baseNgn: amount,
        international: true,
      };
    }
  }
  return out;
}

/**
 * A price as a church reads it: "MT 400", "₦5,000".
 *
 * Whole units, never cents. A subscription is a round number in every currency
 * this sells in, and "MT 400.00" reads like a bank statement rather than a
 * price. Falls back to the symbol when Intl does not know the code — a real
 * risk for the smaller African currencies in older runtimes.
 */
export function planAmountLabel(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencySymbol(currency)}${amount.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  }
}

/**
 * "MT 400/mo" — the label a plan card shows.
 *
 * `copy` comes from the landing dictionary so the suffix and the word for free
 * move with the language. It is optional because the church-facing billing
 * screen has its own dictionary and only ever needs English defaults here.
 */
export function planPriceLabelFor(
  p: PlanPrice,
  copy?: { free?: string; perMonth?: string },
): string {
  if (p.baseNgn === 0) return copy?.free ?? "Free";
  return `${planAmountLabel(p.displayAmount, p.displayCurrency)}${copy?.perMonth ?? "/mo"}`;
}

/**
 * The line under a pricing table explaining the currency and the surcharge.
 *
 * Null for a Nigerian visitor beyond the plain "prices in naira" note: there
 * is nothing to explain, and a paragraph about international card fees on the
 * Nigerian page is noise.
 */
export function currencyNoteFor(
  prices: Record<string, PlanPrice | null>,
  copy: {
    nairaNote: string;
    currencyNote: string;
    currencyNoteIndicative: string;
  },
): string {
  const intl = Object.values(prices).find((p) => p?.international);
  if (!intl) return copy.nairaNote;
  const template = intl.live ? copy.currencyNote : copy.currencyNoteIndicative;
  return template
    .replace("{currency}", intl.displayCurrency)
    .replace("{fee}", `₦${intl.surchargeNgn.toLocaleString()}`);
}

/**
 * The country of whoever is asking, from Cloudflare's edge.
 *
 * `CF-IPCountry` is already on every request, costs nothing, and is right far
 * more often than a guess. Null when Cloudflare cannot place the address —
 * which lands the visitor on the Nigerian price, the honest default for a
 * Nigerian product.
 */
export const requestCountry = cache(async (): Promise<string | null> => {
  try {
    const h = await headers();
    return countryFromIso2(h.get("cf-ipcountry"));
  } catch (err) {
    // First, always: `headers()` bails out of a static render by throwing, and
    // catching that would prerender this page with one visitor's country
    // baked in for everybody.
    unstable_rethrow(err);
    // No request scope: a script or a cron calling a shared helper.
    return null;
  }
});
