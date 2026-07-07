import "server-only";
import { PLANS, PLAN_BY_ID, type Plan, type PlanId } from "@/lib/plans";
import { getSetting, setSetting } from "@/lib/platform-settings";
import {
  DEFAULT_STORAGE_BUNDLES,
  type StorageBundle,
} from "@/lib/storage-bytes";

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

/** Plan catalog with admin-resolved prices AND features applied. */
export async function getPlans(): Promise<Plan[]> {
  const [prices, features] = await Promise.all([
    getPlanPrices(),
    getAllPlanFeatures(),
  ]);
  return PLANS.map((p) => ({
    ...p,
    priceMonthly: prices[p.id],
    features: features[p.id],
  }));
}

/** Persist a plan's monthly price (admin only — caller must authorize). */
export async function setPlanPrice(id: PlanId, price: number): Promise<void> {
  await setSetting(planPriceKey(id), String(Math.max(0, Math.round(price))));
}

/* ----- Plan feature lists (admin-managed) ----- */

export const planFeaturesKey = (id: PlanId) => `plan_features_${id}`;

function cleanFeatures(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 30);
}

/** Resolved feature bullet list for a plan (admin override → built-in default). */
export async function getPlanFeatures(id: PlanId): Promise<string[]> {
  const fallback = PLAN_BY_ID[id]?.features ?? [];
  const raw = await getSetting(planFeaturesKey(id), "");
  if (raw) {
    try {
      const clean = cleanFeatures(JSON.parse(raw));
      if (clean.length) return clean;
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

/** Resolved feature lists for every plan. */
export async function getAllPlanFeatures(): Promise<Record<PlanId, string[]>> {
  const out = {} as Record<PlanId, string[]>;
  await Promise.all(
    PLANS.map(async (p) => {
      out[p.id] = await getPlanFeatures(p.id);
    }),
  );
  return out;
}

/** Persist a plan's feature list (admin only — caller must authorize). */
export async function setPlanFeatures(id: PlanId, features: string[]): Promise<void> {
  await setSetting(planFeaturesKey(id), JSON.stringify(cleanFeatures(features)));
}

/** Apply an admin discount to a base price. */
export function applyDiscount(base: number | null, discountPct: number): number | null {
  if (base === null) return null;
  const pct = Math.min(100, Math.max(0, discountPct || 0));
  return Math.max(0, Math.round(base * (1 - pct / 100)));
}

/* ----- Storage add-on bundles (admin-managed) ----- */

export const STORAGE_BUNDLES_KEY = "storage_bundles";

/** Resolved storage bundles (admin overrides → placeholder defaults). */
export async function getStorageBundles(): Promise<StorageBundle[]> {
  const raw = await getSetting(STORAGE_BUNDLES_KEY, "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const clean = parsed
          .map((b) => ({ gb: Number((b as StorageBundle).gb), price: Number((b as StorageBundle).price) }))
          .filter((b) => Number.isFinite(b.gb) && b.gb > 0 && Number.isFinite(b.price) && b.price >= 0)
          .sort((a, b) => a.gb - b.gb);
        if (clean.length) return clean;
      }
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_STORAGE_BUNDLES;
}

/** Persist storage bundles (admin only — caller must authorize). */
export async function setStorageBundles(bundles: StorageBundle[]): Promise<void> {
  const clean = bundles
    .map((b) => ({ gb: Math.max(1, Math.round(b.gb)), price: Math.max(0, Math.round(b.price)) }))
    .filter((b) => Number.isFinite(b.gb))
    .sort((a, b) => a.gb - b.gb);
  await setSetting(STORAGE_BUNDLES_KEY, JSON.stringify(clean));
}
