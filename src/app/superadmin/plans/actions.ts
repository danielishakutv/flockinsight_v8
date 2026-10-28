"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customPlan } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import {
  defaultTierFeatures,
  deltaBetween,
  FEATURES,
  isFeatureKey,
  PLAN_ORDER,
  type FeatureKey,
} from "@/lib/entitlements";
import { planName, type PlanId } from "@/lib/plans";
import {
  getCustomPlan,
  getTierDeltas,
  loadCatalog,
  setTierDelta,
} from "@/lib/plan-catalog";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/** Every surface a plan's contents or its card can appear on. */
function revalidatePlans() {
  // Everything: the menu's chips, every module's banner, the pricing page and
  // Settings → Billing all read the catalogue.
  revalidatePath("/", "layout");
}

const labels = (keys: readonly FeatureKey[]) => keys.map((k) => FEATURES[k].label).join(", ");

/* ============================================================
 * A tier's ticks
 * ========================================================== */

const tierSchema = z.object({
  tier: z.enum(PLAN_ORDER as [PlanId, ...PlanId[]]),
  features: z.array(z.string()).max(200),
});

/**
 * Save which features a tier includes.
 *
 * The browser sends the ticked boxes; what is stored is how they differ from
 * the code's defaults (lib/entitlements.ts explains why). Ticking a box back
 * to its default therefore removes the change rather than recording it.
 */
export async function saveTierFeaturesAction(
  input: z.input<typeof tierSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That list of features could not be read." };
  const { tier } = parsed.data;
  const ticked = parsed.data.features.filter(isFeatureKey);

  const before = (await loadCatalog()).tiers[tier];
  await setTierDelta(tier, deltaBetween(defaultTierFeatures(tier), ticked));

  const turnedOn = ticked.filter((k) => !before.includes(k));
  const turnedOff = before.filter((k) => !ticked.includes(k));
  if (turnedOn.length || turnedOff.length) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "set_plan_features",
      severity: "notice",
      summary: `${planName(tier)} features changed${turnedOn.length ? ` — added ${labels(turnedOn)}` : ""}${turnedOff.length ? ` — removed ${labels(turnedOff)}` : ""}`,
      meta: { tier, added: turnedOn, removed: turnedOff },
    });
  }
  revalidatePlans();
  return { ok: true };
}

/** Put a tier back to exactly what the code ships. */
export async function resetTierFeaturesAction(tier: PlanId): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  if (!PLAN_ORDER.includes(tier)) return { ok: false, error: "Unknown plan." };

  // Read first, so the log keeps what was undone — there is no other record.
  const before = (await getTierDeltas())[tier];
  await setTierDelta(tier, { added: [], removed: [] });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_plan_features",
    severity: "notice",
    summary: `${planName(tier)} features reset to the defaults${before.added.length ? ` (had added ${labels(before.added)})` : ""}${before.removed.length ? ` (had removed ${labels(before.removed)})` : ""}`,
    meta: { tier, undone: before },
  });
  revalidatePlans();
  return { ok: true };
}

/* ============================================================
 * Custom plans
 * ========================================================== */

/** A whole number, or blank for "no ceiling". */
const limit = (min: number, what: string) =>
  z
    .number({ error: `${what} must be a whole number, or blank for unlimited.` })
    .int(`${what} must be a whole number.`)
    .min(min, `${what} must be at least ${min}.`)
    .max(10_000_000)
    .nullable();

const customSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(2, "Give the plan a name.").max(60),
  tagline: z.string().trim().max(140).default(""),
  basePlan: z.enum(PLAN_ORDER as [PlanId, ...PlanId[]]),
  /** Blank = "contact us": no checkout, a button that says so. */
  priceMonthly: limit(0, "The price"),
  memberLimit: limit(1, "The member limit"),
  teamLimit: limit(1, "The team size"),
  emailAllowance: limit(0, "The email allowance"),
  storageMb: z
    .number({ error: "Storage must be a number of megabytes." })
    .int()
    .min(0)
    .max(1_000_000),
  features: z.array(z.string()).max(200),
  highlights: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  showOnWebsite: z.boolean().default(false),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});

export type CustomPlanInput = z.input<typeof customSchema>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "plan"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [taken] = await db
      .select({ id: customPlan.id })
      .from(customPlan)
      .where(eq(customPlan.slug, slug))
      .limit(1);
    if (!taken) return slug;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/**
 * Create or update a custom plan.
 *
 * The ticks arrive as a full list and are stored as changes against the base
 * tier's LIVE list, so a feature added to that tier later reaches this plan
 * too unless it has been ticked off here in particular.
 */
export async function saveCustomPlanAction(input: CustomPlanInput): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = customSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the plan's details." };
  const d = parsed.data;

  const catalog = await loadCatalog();
  const delta = deltaBetween(catalog.tiers[d.basePlan], d.features.filter(isFeatureKey));
  const values = {
    name: d.name,
    tagline: d.tagline,
    basePlan: d.basePlan,
    priceMonthly: d.priceMonthly,
    memberLimit: d.memberLimit,
    teamLimit: d.teamLimit,
    emailAllowance: d.emailAllowance,
    storageMb: d.storageMb,
    featuresAdded: [...delta.added],
    featuresRemoved: [...delta.removed],
    highlights: d.highlights,
    showOnWebsite: d.showOnWebsite,
    sortOrder: d.sortOrder,
  };

  const price =
    d.priceMonthly === null ? "contact us" : d.priceMonthly === 0 ? "free" : `₦${d.priceMonthly.toLocaleString()}/mo`;

  if (d.id) {
    const existing = await getCustomPlan(d.id);
    if (!existing) return { ok: false, error: "That plan no longer exists." };
    if (d.showOnWebsite && existing.archivedAt)
      return { ok: false, error: "Restore the plan before putting it on the website." };
    await db.update(customPlan).set(values).where(eq(customPlan.id, d.id));
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "custom_plan.update",
      severity: "notice",
      summary: `Updated the custom plan "${d.name}" (from ${planName(d.basePlan)}, ${price}${d.showOnWebsite ? ", on the website" : ""})`,
      targetType: "custom_plan",
      targetId: d.id,
      targetLabel: d.name,
      meta: { ...values },
    });
    revalidatePlans();
    return { ok: true, id: d.id };
  }

  const id = randomUUID();
  await db.insert(customPlan).values({
    id,
    slug: await uniqueSlug(d.name),
    createdBy: admin.id,
    ...values,
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "custom_plan.create",
    severity: "notice",
    summary: `Created the custom plan "${d.name}" (from ${planName(d.basePlan)}, ${price}${d.showOnWebsite ? ", on the website" : ""})`,
    targetType: "custom_plan",
    targetId: id,
    targetLabel: d.name,
    meta: { ...values },
  });
  revalidatePlans();
  return { ok: true, id };
}

/**
 * Archive or restore a custom plan.
 *
 * Archiving takes it off the website and out of every picker. Churches already
 * on it keep it, and keep paying for it — moving them is a decision made one
 * church at a time, on the church's own page, never as a side effect of this.
 */
export async function setCustomPlanArchivedAction(
  id: string,
  archived: boolean,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const existing = await getCustomPlan(id);
  if (!existing) return { ok: false, error: "That plan no longer exists." };

  await db
    .update(customPlan)
    .set(
      archived
        ? { archivedAt: new Date(), showOnWebsite: false }
        : { archivedAt: null },
    )
    .where(eq(customPlan.id, id));
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: archived ? "custom_plan.archive" : "custom_plan.restore",
    severity: "notice",
    summary: archived
      ? `Archived the custom plan "${existing.name}" — off the website; churches on it keep it`
      : `Restored the custom plan "${existing.name}"`,
    targetType: "custom_plan",
    targetId: id,
    targetLabel: existing.name,
  });
  revalidatePlans();
  return { ok: true };
}
