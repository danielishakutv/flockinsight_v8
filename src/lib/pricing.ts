import "server-only";
import { PLANS, PLAN_BY_ID, type Plan, type PlanId } from "@/lib/plans";
import { getSetting, setSetting } from "@/lib/platform-settings";
import { formatBytes, MB, planStorageBytes } from "@/lib/storage-bytes";
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

/**
 * Plan catalog with admin-resolved prices, features AND allowances applied.
 *
 * The storage and email lines are GENERATED from the live allowances rather than
 * written into the bullet list, and that is deliberate. Those two numbers are
 * admin-editable precisely because a supplier's pricing moves — so a bullet
 * saying "200 MB for photos" is a sentence that goes wrong the first time
 * somebody answers a bill from their phone. The live page advertised 200 MB and
 * 500 MB while the enforced allowances were 100 MB and 300 MB, and the only
 * reason nobody noticed is that no church ever filled the smaller one.
 *
 * They go at the top of the list, after the member limit, because what a plan
 * includes is the second thing anybody looks for.
 */
export async function getPlans(): Promise<Plan[]> {
  const [prices, features, storageMb, emails] = await Promise.all([
    getPlanPrices(),
    getAllPlanFeatures(),
    getAllPlanStorageMb(),
    getAllPlanEmails(),
  ]);
  return PLANS.map((p) => ({
    ...p,
    priceMonthly: prices[p.id],
    emailAllowance: emails[p.id],
    features: [
      ...features[p.id],
      `${formatBytes(storageMb[p.id] * MB, 0)} of storage for photos, documents and media`,
      emails[p.id] === null
        ? "Email volume to suit"
        : `${emails[p.id]!.toLocaleString()} emails a month`,
    ],
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

/* ----- Storage & email allowances (admin-managed) ----- */

/*
 * These two are what the bill is actually made of, so they live here rather
 * than only in code: the operator must be able to change what a plan includes
 * from the admin, on a phone, the day a supplier's pricing moves — without a
 * deploy. The values in lib/plans.ts stay as the defaults a fresh install
 * shows and the floor these fall back to.
 */

export const planStorageKey = (id: PlanId) => `plan_storage_mb_${id}`;
export const planEmailsKey = (id: PlanId) => `plan_emails_${id}`;

/** Included storage for a plan, in MEGABYTES. */
export async function getPlanStorageMb(id: PlanId): Promise<number> {
  const fallback = Math.round(planStorageBytes(id) / MB);
  // An empty stored value means "no override", not zero — `Number("")` is 0,
  // which would silently give the plan no storage at all.
  const stored = (await getSetting(planStorageKey(id), "")).trim();
  if (stored === "") return fallback;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : fallback;
}

export async function getAllPlanStorageMb(): Promise<Record<PlanId, number>> {
  const out = {} as Record<PlanId, number>;
  await Promise.all(PLANS.map(async (p) => (out[p.id] = await getPlanStorageMb(p.id))));
  return out;
}

export async function setPlanStorageMb(id: PlanId, mb: number): Promise<void> {
  await setSetting(planStorageKey(id), String(Math.max(0, Math.round(mb || 0))));
}

/**
 * Included emails per month. `null` means unlimited, stored as an empty
 * string — which is the only value an operator can type that unambiguously
 * means "no ceiling" rather than "zero".
 */
export async function getPlanEmails(id: PlanId): Promise<number | null> {
  const fallback = PLAN_BY_ID[id]?.emailAllowance ?? null;
  const raw = (await getSetting(planEmailsKey(id), "")).trim();
  if (raw === "") return fallback;
  if (raw === "unlimited") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export async function getAllPlanEmails(): Promise<Record<PlanId, number | null>> {
  const out = {} as Record<PlanId, number | null>;
  await Promise.all(PLANS.map(async (p) => (out[p.id] = await getPlanEmails(p.id))));
  return out;
}

export async function setPlanEmails(id: PlanId, emails: number | null): Promise<void> {
  await setSetting(
    planEmailsKey(id),
    emails === null ? "unlimited" : String(Math.max(0, Math.round(emails))),
  );
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

/**
 * Whether a plan's public copy is a saved override or the built-in default.
 *
 * Worth surfacing, because an override is invisible and permanent: the live
 * pricing page was still advertising "Up to 70 members" and "Basic giving
 * tracking" long after neither existed in the code, because somebody had once
 * saved a feature list and nothing ever said so.
 */
export async function planCopyIsOverridden(id: PlanId): Promise<boolean> {
  const [f, st, em] = await Promise.all([
    getSetting(planFeaturesKey(id), ""),
    getSetting(planStorageKey(id), ""),
    getSetting(planEmailsKey(id), ""),
  ]);
  return !!(f.trim() || st.trim() || em.trim());
}

export async function allPlanCopyOverridden(): Promise<Record<PlanId, boolean>> {
  const out = {} as Record<PlanId, boolean>;
  await Promise.all(PLANS.map(async (p) => (out[p.id] = await planCopyIsOverridden(p.id))));
  return out;
}

/**
 * Whether a plan's bullet list is a saved override that no longer matches the
 * app, and what the app would say instead.
 *
 * The whole reason this exists: an override is invisible and permanent, so every
 * module shipped after somebody once pressed Save was missing from the price
 * list and nothing anywhere said so. The admin now shows the difference, and can
 * hand the plan back to the code in one press.
 */
export async function planFeatureDrift(id: PlanId): Promise<{
  overridden: boolean;
  live: string[];
  builtIn: string[];
  /** Built-in bullets the live list does not have — what churches are not told. */
  missing: string[];
}> {
  const builtIn = PLAN_BY_ID[id]?.features ?? [];
  const saved = (await getSetting(planFeaturesKey(id), "")).trim();
  if (!saved) return { overridden: false, live: builtIn, builtIn, missing: [] };

  let live = builtIn;
  try {
    const parsed = cleanFeatures(JSON.parse(saved));
    if (parsed.length) live = parsed;
  } catch {
    /* an unreadable override is treated as none, same as every reader here */
  }
  const have = new Set(live.map((l) => l.toLowerCase()));
  return {
    overridden: true,
    live,
    builtIn,
    missing: builtIn.filter((b) => !have.has(b.toLowerCase())),
  };
}

export type PlanFeatureDrift = Awaited<ReturnType<typeof planFeatureDrift>>;

export async function allPlanFeatureDrift(): Promise<Record<PlanId, PlanFeatureDrift>> {
  const out = {} as Record<PlanId, PlanFeatureDrift>;
  await Promise.all(PLANS.map(async (p) => (out[p.id] = await planFeatureDrift(p.id))));
  return out;
}

/**
 * Hand a plan's bullet list back to the code, leaving its allowances alone.
 *
 * Separate from `resetPlanCopy`, which also clears the storage and email
 * overrides. Those are numbers an operator may have tuned deliberately against a
 * supplier's bill, and losing them to fix a stale sentence would be its own
 * quiet data loss.
 */
export async function resetPlanFeatures(id: PlanId): Promise<void> {
  await setSetting(planFeaturesKey(id), "");
}

/**
 * Drop a plan's overrides so the built-in copy applies again.
 *
 * Clearing rather than deleting: the row stays, emptied, which every reader
 * here already treats as "no opinion". There was no way back from a stale
 * override before this.
 */
export async function resetPlanCopy(id: PlanId): Promise<void> {
  await Promise.all([
    setSetting(planFeaturesKey(id), ""),
    setSetting(planStorageKey(id), ""),
    setSetting(planEmailsKey(id), ""),
  ]);
}
