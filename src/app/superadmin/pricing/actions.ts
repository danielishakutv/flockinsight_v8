"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  planFeatureDrift,
  setAnnualFreeMonths,
  resetPlanCopy,
  resetPlanFeatures,
  setPlanEmails,
  setPlanFeatures,
  setPlanPrice,
  setPlanStorageMb,
  setStorageBundles,
} from "@/lib/pricing";
import { planName, type PlanId } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";
import { setReferralRewards } from "@/lib/referrals";

import { requirePlatform } from "@/lib/platform-access";
export type ActionResult = { ok: true } | { ok: false; error: string };

/*
 * Clearing a price field to retype it used to save ₦0 — `Number("")` is 0,
 * and 0 passed `min(0)`. Every church could then activate Pro, a year of it,
 * for nothing, through the free-plan path. So a paid tier has a floor, a
 * blank or non-number is refused rather than read as zero, and the tiers must
 * stay in order. Starter may still be 0: a free entry tier is a real option.
 */
const price = (floor: number, name: string) =>
  z
    .number({ error: `Enter a price for ${name}.` })
    .int(`${name}'s price must be a whole number of naira.`)
    .min(floor, floor > 0 ? `${name} must cost at least ₦${floor}.` : `${name} cannot be negative.`)
    .max(10_000_000);

const schema = z
  .object({
    starter: price(0, "Starter"),
    growth: price(100, "Growth"),
    pro: price(100, "Pro"),
  })
  .refine((d) => d.growth >= d.starter, {
    message: "Growth cannot cost less than Starter.",
  })
  .refine((d) => d.pro >= d.growth, { message: "Pro cannot cost less than Growth." });

export type PlanPriceInput = z.infer<typeof schema>;

export async function setPlanPrices(input: PlanPriceInput): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid price" };
  const d = parsed.data;

  await Promise.all([
    setPlanPrice("starter", d.starter),
    setPlanPrice("growth", d.growth),
    setPlanPrice("pro", d.pro),
  ]);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    summary: `Updated plan prices — Starter ₦${d.starter}, Growth ₦${d.growth}, Pro ₦${d.pro}`,
  });

  // Refresh the public surfaces that show prices.
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

/**
 * How many months a church gets free for paying a year up front.
 *
 * Capped at 11 by the schema and again by `normaliseFreeMonths`, because 12
 * free months out of 12 is the whole product given away by a typo — the kind
 * of single keystroke that is worth refusing in two places.
 */
const annualSchema = z.object({ freeMonths: z.number().min(0).max(11) });

export async function setAnnualFreeMonthsAction(
  input: z.input<typeof annualSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = annualSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid number of months",
    };

  const { freeMonths } = parsed.data;
  await setAnnualFreeMonths(freeMonths);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    summary:
      freeMonths === 0
        ? "Turned off the annual billing discount"
        : `Annual billing: ${freeMonths} month${freeMonths === 1 ? "" : "s"} free — a year now costs ${12 - freeMonths} months`,
  });

  // Every surface that quotes a yearly price.
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/settings/billing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

const featuresSchema = z.object({
  plan: z.enum(["starter", "growth", "pro", "enterprise"]),
  features: z.array(z.string().trim().min(1).max(120)).max(30),
});

export async function setPlanFeaturesAction(
  input: z.input<typeof featuresSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = featuresSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  await setPlanFeatures(parsed.data.plan as PlanId, parsed.data.features);
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_plan_features",
    summary: `Updated ${planName(parsed.data.plan)} plan features (${parsed.data.features.length} items)`,
  });
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

const bundlesSchema = z
  .array(
    z.object({
      gb: z.number().int().min(1).max(10_000),
      price: z.number().min(0).max(10_000_000),
    }),
  )
  .max(8);

export type StorageBundleInput = z.infer<typeof bundlesSchema>;

export async function setStorageBundlesAction(
  input: StorageBundleInput,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = bundlesSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid bundle" };

  await setStorageBundles(parsed.data);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_storage_pricing",
    summary: `Updated storage bundles — ${parsed.data
      .map((b) => `${b.gb}GB ₦${b.price}`)
      .join(", ")}`,
  });

  revalidatePath("/superadmin/pricing");
  revalidatePath("/settings/storage");
  return { ok: true };
}

const referralSchema = z.object({
  referrer: z.number().min(0).max(1_000_000),
  referred: z.number().min(0).max(1_000_000),
});

export type ReferralRewardInput = z.infer<typeof referralSchema>;

/**
 * What a referral pays. Changing it affects referrals rewarded from now on;
 * bonuses already credited are in the wallet ledger and are not revisited.
 */
export async function setReferralRewardsAction(
  input: ReferralRewardInput,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = referralSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid amount" };

  await setReferralRewards(parsed.data);
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_referral_rewards",
    summary: `Referral rewards set to ₦${parsed.data.referrer} (referrer) / ₦${parsed.data.referred} (new church)`,
  });

  revalidatePath("/superadmin/pricing");
  revalidatePath("/settings/referrals");
  return { ok: true };
}

/* ----- Included storage & emails ----- */

const allowanceSchema = z.object({
  plan: z.enum(["starter", "growth", "pro", "enterprise"]),
  /** Megabytes, so the operator types 500 rather than 524288000. */
  storageMb: z.coerce.number().int().min(0).max(1_000_000),
  /** Blank means unlimited — the only thing somebody can type that is not zero. */
  emails: z.string().trim().max(12),
});

/**
 * What a plan includes, as opposed to what it costs.
 *
 * Separate from the price action on purpose: these are the numbers that decide
 * the supplier bill, and they move for entirely different reasons than a price
 * does. An operator raising storage is answering Cloudinary; one raising a
 * price is answering the market.
 */
export async function setPlanAllowancesAction(
  input: z.input<typeof allowanceSchema>,
): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  const parsed = allowanceSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those numbers." };
  const d = parsed.data;

  const emails =
    d.emails === "" || d.emails.toLowerCase() === "unlimited"
      ? null
      : Number(d.emails);
  if (emails !== null && (!Number.isFinite(emails) || emails < 0)) {
    return { ok: false, error: "Emails must be a number, or blank for unlimited." };
  }

  await Promise.all([
    setPlanStorageMb(d.plan, d.storageMb),
    setPlanEmails(d.plan, emails),
  ]);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    severity: "notice",
    summary: `Updated ${d.plan} allowances — ${d.storageMb} MB storage, ${emails === null ? "unlimited" : emails} emails/month`,
  });

  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

/**
 * Put a plan's public copy back to the built-in default.
 *
 * The live pricing page can drift a long way from the product without anybody
 * noticing: a feature list saved once overrides the code for ever, so the site
 * was still advertising "Up to 70 members" and "Basic giving tracking" after
 * both had gone. This is the way back.
 */
export async function resetPlanCopyAction(plan: PlanId): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  if (!["starter", "growth", "pro", "enterprise"].includes(plan)) {
    return { ok: false, error: "Unknown plan." };
  }

  await resetPlanCopy(plan);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    severity: "notice",
    summary: `Reset ${planName(plan)} features and allowances to the built-in defaults`,
  });

  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}

/**
 * Hand one plan's bullet list back to the built-in copy.
 *
 * The counterpart to saving one. Pressing Save pins a list for ever, which is how
 * the live price list came to be advertising a member limit and a feature set
 * from long after both had changed — and why not one module shipped since then
 * appeared on it. This is the way back.
 *
 * Unlike `resetPlanCopyAction` it leaves the storage and email allowances exactly
 * as they were: those are numbers an operator may have tuned against a real
 * supplier bill, and losing them to fix a stale sentence would be its own quiet
 * data loss.
 */
export async function resetPlanFeaturesAction(plan: PlanId): Promise<ActionResult> {
  const admin = await requirePlatform("platform.pricing.manage");
  if (!["starter", "growth", "pro", "enterprise"].includes(plan)) {
    return { ok: false, error: "Unknown plan." };
  }

  // Read before clearing, so the log keeps the copy that was replaced. There is
  // no other record of it once the setting is empty.
  const before = await planFeatureDrift(plan);
  await resetPlanFeatures(plan);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "set_pricing",
    severity: "notice",
    summary: `Reset the ${planName(plan)} feature list to the built-in copy (was ${before.live.length} bullets, now ${before.builtIn.length})`,
  });

  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/superadmin/pricing");
  return { ok: true };
}
