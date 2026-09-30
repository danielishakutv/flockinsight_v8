import "server-only";
import { unstable_cache } from "next/cache";

/**
 * What a naira is worth elsewhere, and what to charge a church that is not in
 * Nigeria.
 *
 * Two separate problems, deliberately solved in one place.
 *
 * The first is display: a pastor in Maputo reading "₦5,000" has no idea
 * whether that is a lot. Showing the same price in meticais is the difference
 * between a price and a number.
 *
 * The second is cost. Paystack accepts international cards, so the charge can
 * stay in naira and work — but cross-border card processing costs several
 * times what a local card does, and on a ₦5,000 subscription those fees eat
 * most of the margin. So an international plan carries a surcharge that covers
 * them, and the church is shown the real total in its own money rather than a
 * naira figure that becomes something else on their statement.
 */

/**
 * The surcharge, in US dollars.
 *
 * Covers Paystack's international card fee, which runs several percent plus a
 * fixed component, and the FX spread the card issuer takes on top. Two dollars
 * is deliberately more than the fee on the smallest plan: the alternative is
 * pricing each plan separately and discovering the shortfall a quarter later.
 */
export const INTERNATIONAL_SURCHARGE_USD = 2;

/**
 * Never charge an international church less than this, in naira.
 *
 * Below it the processing fee is a large fraction of the payment and the
 * transaction is not worth taking.
 */
export const INTERNATIONAL_FLOOR_NGN = 5000;

export type Rates = {
  /** How many of each currency one NGN buys. */
  perNgn: Record<string, number>;
  fetchedAt: string;
  /** False when we are running on the fallback table below. */
  live: boolean;
};

/**
 * A rough table, used only when the rate service cannot be reached.
 *
 * Wrong within months, and that is accepted: the alternative is a pricing page
 * that fails to render. Every number here is deliberately CONSERVATIVE — it
 * over-states what a naira is worth, so a stale table quotes a church slightly
 * too much rather than selling below cost. `live: false` is carried through so
 * the page can say the figure is indicative.
 */
const FALLBACK_PER_NGN: Record<string, number> = {
  USD: 1 / 1550,
  EUR: 1 / 1650,
  GBP: 1 / 1950,
  ZAR: 1 / 85,
  KES: 1 / 12,
  GHS: 1 / 100,
  MZN: 1 / 24,
  TZS: 1 / 0.6,
  UGX: 1 / 0.42,
  XOF: 1 / 2.6,
  XAF: 1 / 2.6,
  ZMW: 1 / 60,
  MWK: 1 / 0.9,
  RWF: 1 / 1.1,
  BWP: 1 / 115,
  AOA: 1 / 1.7,
  CAD: 1 / 1150,
  AUD: 1 / 1040,
  BRL: 1 / 280,
};

/**
 * Live rates, refreshed daily.
 *
 * open.er-api.com is free and needs no key, which matters: a pricing page that
 * depends on a billable API is a pricing page that breaks when a card expires.
 * One request a day, cached, and a fallback table when it fails — the page
 * must always render a number.
 */
async function loadRates(): Promise<Rates> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/NGN", {
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (json?.result === "success" && json.rates && json.rates.USD) {
      return {
        perNgn: json.rates,
        fetchedAt: new Date().toISOString(),
        live: true,
      };
    }
  } catch {
    // Network, timeout, or a shape we did not expect. Fall through — a stale
    // price beats a broken page, and `live: false` says which one this is.
  }
  return {
    perNgn: FALLBACK_PER_NGN,
    fetchedAt: new Date().toISOString(),
    live: false,
  };
}

export const getRates = unstable_cache(loadRates, ["fx-rates"], {
  revalidate: 60 * 60 * 12,
  tags: ["fx"],
});

/** One naira, in `currency`. Null when we have no rate for it. */
export function rateFor(rates: Rates, currency: string): number | null {
  const r = rates.perNgn[currency.toUpperCase()];
  return typeof r === "number" && r > 0 ? r : null;
}

export type InternationalPrice = {
  /** What Paystack is actually charged, in naira. */
  chargeNgn: number;
  /** The same amount in the church's currency, for display. */
  displayAmount: number;
  displayCurrency: string;
  /** The surcharge portion, in naira, so the page can itemise it. */
  surchargeNgn: number;
  /** False when the conversion used the fallback table. */
  live: boolean;
};

/**
 * Round up to something that looks like a price.
 *
 * A converted figure lands on 7,431.88, which reads as an accident rather than
 * a decision. Rounding UP also means the surcharge is never eroded by rounding
 * the wrong way.
 *
 * The step is derived from the SIZE of the amount rather than fixed, and that
 * is the whole point. Fixed naira-shaped steps (50 / 100 / 500) are sensible
 * for ₦7,657 and absurd for €8.49 — which rounded up to €50, so every plan
 * on the French page showed the same price, six times what the church would
 * actually pay. This sells in currencies three orders of magnitude apart; the
 * only rule that survives all of them is a relative one.
 *
 * Two significant figures, always up, never finer than 1 whole unit:
 *
 *     €8.49      -> €9          MT 616   -> MT 620
 *     KSh 1,269  -> KSh 1,300   ₦7,657  -> ₦7,700
 *
 * Never finer than 1 because no subscription anywhere is priced in cents.
 */
export function roundUpPrice(amount: number): number {
  if (amount <= 0) return 0;
  const digits = Math.floor(Math.log10(amount)) + 1;
  const step = Math.max(1, 10 ** (digits - 2));
  return Math.ceil(amount / step) * step;
}

/**
 * What to charge, and what to show, for a church outside Nigeria.
 *
 * The charge stays in naira because that is what Paystack settles in and what
 * international cards can already pay. The surcharge is added in naira before
 * conversion, so the church sees one honest total in its own money rather than
 * a base price and a surprise on the statement.
 */
export function internationalPrice(
  baseNgn: number,
  currency: string,
  rates: Rates,
): InternationalPrice {
  const usdPerNgn = rateFor(rates, "USD");
  const surchargeNgn = usdPerNgn ? Math.ceil(INTERNATIONAL_SURCHARGE_USD / usdPerNgn) : 0;

  const chargeNgn = Math.max(
    INTERNATIONAL_FLOOR_NGN,
    roundUpPrice(baseNgn + surchargeNgn),
  );

  const rate = rateFor(rates, currency);
  return {
    chargeNgn,
    // No rate for their currency: show the naira figure rather than inventing
    // a conversion. An honest foreign number beats a confident wrong one.
    displayAmount: rate ? roundUpPrice(chargeNgn * rate) : chargeNgn,
    displayCurrency: rate ? currency.toUpperCase() : "NGN",
    surchargeNgn,
    live: rates.live,
  };
}
