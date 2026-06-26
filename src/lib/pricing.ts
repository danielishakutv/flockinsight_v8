import "server-only";
import { PLANS, PLAN_BY_ID, type Plan, type PlanId } from "@/lib/plans";
import { getSetting, setSetting } from "@/lib/platform-settings";

/**
 * Plan pricing is admin-managed: the monthly price for each paid plan can be
 * overridden in platform_setting (key `plan_price_<id>`), falling back to the
 * built-in default in plans.ts. Enterprise stays custom (null).
 *
 * Every price shown to churches or charged at checkout resolves through here,
 * so a change in Platform Admin → Pricing reflects on the landing page, the
 * pricing page and the church billing/payment flow.
 */
export const PRICED_PLANS: PlanId[] = ["starter", "growth", "pro"];

export const planPriceKey = (id: PlanId) => `plan_price_${id}`;

function clean(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/** Resolved monthly price for one plan (null = custom). */
export async function getPlanPrice(id: string): Promise<number | null> {
  const p = PLAN_BY_ID[id as PlanId];
  if (!p || p.priceMonthly === null) return null;
  return clean(await getSetting(planPriceKey(id as PlanId), String(p.priceMonthly)), p.priceMonthly);
}

/** Resolved monthly prices for every plan. */
export async function getPlanPrices(): Promise<Record<PlanId, number | null>> {
  const out = {} as Record<PlanId, number | null>;
  await Promise.all(
    PLANS.map(async (p) => {
      out[p.id] =
        p.priceMonthly === null
          ? null
          : clean(await getSetting(planPriceKey(p.id), String(p.priceMonthly)), p.priceMonthly);
    }),
  );
  return out;
}

/** Plan catalog with admin-resolved prices applied. */
export async function getPlans(): Promise<Plan[]> {
  const prices = await getPlanPrices();
  return PLANS.map((p) => ({ ...p, priceMonthly: prices[p.id] }));
}

/** Persist a plan's monthly price (admin only — caller must authorize). */
export async function setPlanPrice(id: PlanId, price: number): Promise<void> {
  await setSetting(planPriceKey(id), String(Math.max(0, Math.round(price))));
}

/** Apply an admin discount to a base price. */
export function applyDiscount(base: number | null, discountPct: number): number | null {
  if (base === null) return null;
  const pct = Math.min(100, Math.max(0, discountPct || 0));
  return Math.max(0, Math.round(base * (1 - pct / 100)));
}
