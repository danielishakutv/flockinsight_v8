import "server-only";
import { cache } from "react";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, customPlan, platformSetting } from "@/db/schema";
import {
  buildCatalog,
  churchRowHasFeature,
  cleanDelta,
  PLAN_ORDER,
  planRank,
  teamLimitFor,
  type EntitlementCatalog,
  type FeatureDelta,
  type FeatureKey,
  type PlanHolder,
} from "@/lib/entitlements";
import { PLAN_BY_ID, parsePlanKey, type PlanId } from "@/lib/plans";
import { setSetting } from "@/lib/platform-settings";

/**
 * What every plan includes, as the admin has set it — the server half of
 * the live catalogue described in lib/entitlements.ts.
 *
 * Two things are stored here, and both are CHANGES rather than lists:
 *
 *   - a tier's ticks, as `platform_setting.plan_feature_delta_<tier>`
 *     ({ added, removed } against the code's defaults), and
 *   - custom plans, as rows of `custom_plan`, each starting from a tier.
 *
 * Every check that decides what a church may do loads the catalogue from
 * here, once per request.
 */

export const tierDeltaKey = (tier: PlanId) => `plan_feature_delta_${tier}`;

export type CustomPlanRow = typeof customPlan.$inferSelect;

/** Each tier's stored changes. A tier nobody has touched has none. */
export async function getTierDeltas(): Promise<Record<PlanId, FeatureDelta>> {
  const rows = await db
    .select({ key: platformSetting.key, value: platformSetting.value })
    .from(platformSetting)
    .where(inArray(platformSetting.key, PLAN_ORDER.map(tierDeltaKey)));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<PlanId, FeatureDelta>;
  for (const t of PLAN_ORDER) {
    const raw = (byKey.get(tierDeltaKey(t)) ?? "").trim();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // Said out loud: an unreadable value means this tier is enforcing its
        // defaults, which may not be what the admin last saw on the page.
        console.error(`[plan-catalog] ${tierDeltaKey(t)} is not valid JSON; using the defaults`, e);
      }
    }
    out[t] = cleanDelta(parsed);
  }
  return out;
}

/** Store a tier's changes. An empty delta means "the defaults". Caller authorises. */
export async function setTierDelta(tier: PlanId, delta: FeatureDelta): Promise<void> {
  const clean = cleanDelta(delta);
  await setSetting(
    tierDeltaKey(tier),
    clean.added.length || clean.removed.length ? JSON.stringify(clean) : "",
  );
}

/** Custom plans, archived ones last. */
export async function listCustomPlans(
  opts: { includeArchived?: boolean } = {},
): Promise<CustomPlanRow[]> {
  const rows = await db
    .select()
    .from(customPlan)
    .orderBy(asc(customPlan.sortOrder), asc(customPlan.createdAt));
  const live = rows.filter((r) => !r.archivedAt);
  return opts.includeArchived ? [...live, ...rows.filter((r) => r.archivedAt)] : live;
}

export async function getCustomPlan(id: string): Promise<CustomPlanRow | null> {
  const [row] = await db.select().from(customPlan).where(eq(customPlan.id, id)).limit(1);
  return row ?? null;
}

export function customDelta(row: Pick<CustomPlanRow, "featuresAdded" | "featuresRemoved">) {
  return cleanDelta({ added: row.featuresAdded, removed: row.featuresRemoved });
}

/**
 * The live catalogue, once per request.
 *
 * Archived custom plans are in it: archiving stops new churches choosing a
 * plan, it does not take a plan away from the churches already on it.
 */
export const loadCatalog = cache(async (): Promise<EntitlementCatalog> => {
  const [deltas, customs] = await Promise.all([
    getTierDeltas(),
    db
      .select({
        id: customPlan.id,
        name: customPlan.name,
        basePlan: customPlan.basePlan,
        featuresAdded: customPlan.featuresAdded,
        featuresRemoved: customPlan.featuresRemoved,
      })
      .from(customPlan),
  ]);
  return buildCatalog(
    deltas,
    customs.map((c) => ({ id: c.id, name: c.name, basePlan: c.basePlan, delta: customDelta(c) })),
  );
});

/** churchRowHasFeature with the live catalogue — for a row already in hand. */
export async function rowHasFeature(
  row: PlanHolder & { slug: string | null; isDemo: boolean | null },
  feature: FeatureKey,
): Promise<boolean> {
  return churchRowHasFeature(row, feature, await loadCatalog());
}

/** The same, for a church known only by id (a meeting link, a public form). */
export async function churchIdHasFeature(churchId: string, feature: FeatureKey): Promise<boolean> {
  const [row] = await db
    .select({
      plan: church.plan,
      customPlanId: church.customPlanId,
      slug: church.slug,
      isDemo: church.isDemo,
    })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!row) return false;
  return rowHasFeature(row, feature);
}

/* ============================================================
 * Limits
 * ========================================================== */

export type PlanLimits = {
  /** What a church reads as its plan's name. */
  name: string;
  /** The tier everything not set by a custom plan follows. */
  tier: PlanId;
  custom: boolean;
  /** Null = unlimited, for all three. */
  memberLimit: number | null;
  teamLimit: number | null;
  emailAllowance: number | null;
  storageMb: number;
};

/**
 * The limits a church's plan sets.
 *
 * A custom plan sets its own four numbers; a tier reads the admin's storage
 * and email figures from /superadmin/pricing and its member and team limits
 * from the code, as it always has.
 */
export async function planLimitsFor(holder: PlanHolder): Promise<PlanLimits> {
  const tier = PLAN_ORDER[planRank(holder.plan)];
  if (holder.customPlanId) {
    const c = await getCustomPlan(holder.customPlanId);
    if (c) {
      return {
        name: c.name,
        tier,
        custom: true,
        memberLimit: c.memberLimit,
        teamLimit: c.teamLimit,
        emailAllowance: c.emailAllowance,
        storageMb: c.storageMb,
      };
    }
    console.error(
      `[plan-catalog] custom plan ${holder.customPlanId} not found; using the ${tier} tier's limits`,
    );
  }
  const { getPlanEmails, getPlanStorageMb } = await import("@/lib/pricing");
  const [emailAllowance, storageMb] = await Promise.all([
    getPlanEmails(tier),
    getPlanStorageMb(tier),
  ]);
  return {
    name: PLAN_BY_ID[tier].name,
    tier,
    custom: false,
    memberLimit: PLAN_BY_ID[tier].memberLimit,
    teamLimit: teamLimitFor(tier),
    emailAllowance,
    storageMb,
  };
}

/** A church's limits, by id. */
export async function churchPlanLimits(churchId: string): Promise<PlanLimits> {
  const [row] = await db
    .select({ plan: church.plan, customPlanId: church.customPlanId })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return planLimitsFor(row ?? { plan: "starter", customPlanId: null });
}

/** The names of custom plans by id, for tables that list many churches. */
export async function customPlanNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: customPlan.id, name: customPlan.name }).from(customPlan);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** What to call a church's plan, given the names above. */
export function planLabel(
  holder: PlanHolder,
  names: Map<string, string>,
): string {
  const custom = holder.customPlanId ? names.get(holder.customPlanId) : undefined;
  return custom ?? PLAN_BY_ID[PLAN_ORDER[planRank(holder.plan)]].name;
}

/** What to call a plan key in a sentence: "Growth", "Student Fellowship". */
export async function planKeyName(key: string): Promise<string> {
  const parsed = parsePlanKey(key);
  if (!parsed) return key;
  if ("tier" in parsed) return PLAN_BY_ID[parsed.tier].name;
  return (await getCustomPlan(parsed.customId))?.name ?? "a custom plan";
}

/* ============================================================
 * Plan keys → what a church is put on
 * ========================================================== */

export type PlanTarget = {
  /** What `church.plan` becomes: the tier, or the custom plan's base tier. */
  plan: PlanId;
  /** What `church.custom_plan_id` becomes. Null clears it. */
  customPlanId: string | null;
  name: string;
  /** Monthly list price in naira; null = contact us. */
  priceMonthly: number | null;
  archived: boolean;
  showOnWebsite: boolean;
};

/**
 * Resolve a plan key ("growth", "custom:<id>") to what a church would be put
 * on. Null for a key that names nothing. Prices for tiers come from the
 * admin's pricing page, exactly as checkout reads them.
 */
export async function resolvePlanKey(key: string): Promise<PlanTarget | null> {
  const parsed = parsePlanKey(key);
  if (!parsed) return null;
  if ("tier" in parsed) {
    const { getPlanPrice } = await import("@/lib/pricing");
    return {
      plan: parsed.tier,
      customPlanId: null,
      name: PLAN_BY_ID[parsed.tier].name,
      priceMonthly: await getPlanPrice(parsed.tier),
      archived: false,
      showOnWebsite: true,
    };
  }
  const c = await getCustomPlan(parsed.customId);
  if (!c) return null;
  return {
    plan: c.basePlan,
    customPlanId: c.id,
    name: c.name,
    priceMonthly: c.priceMonthly,
    archived: !!c.archivedAt,
    showOnWebsite: c.showOnWebsite,
  };
}

/**
 * A plan key from a superadmin picker, resolved for one church.
 *
 * An archived custom plan is refused unless the church is already on it:
 * archiving means no NEW church joins it, while a church already there must
 * still be able to have its months extended or a transfer recorded without
 * being moved off it.
 */
export async function resolvePlanForChurch(
  churchId: string,
  key: string,
): Promise<{ ok: true; target: PlanTarget } | { ok: false; error: string }> {
  const target = await resolvePlanKey(key);
  if (!target) return { ok: false, error: "Invalid plan" };
  if (target.archived) {
    const [c] = await db
      .select({ customPlanId: church.customPlanId })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1);
    if (c?.customPlanId !== target.customPlanId)
      return {
        ok: false,
        error: `${target.name} is archived. Restore it in Plans & features first.`,
      };
  }
  return { ok: true, target };
}
