/**
 * Database-backed checks for ticked features and custom plans.
 * Run with `pnpm test:db`.
 *
 * The pure rules are in plan-matrix.test.ts. These prove the parts only a
 * database can: that a payment for a custom plan puts the church on it, that
 * every limit a custom plan sets is the one enforced, that paying for a tier
 * afterwards takes the church off it again, and that a tier's ticks reach a
 * real church.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, customPlan, payment, platformSetting } from "@/db/schema";

vi.mock("@/lib/audit", () => ({ auditSystem: async () => {}, audit: async () => {} }));
vi.mock("@/lib/partners", () => ({ awardPartnerCommission: async () => {} }));
vi.mock("@/lib/referrals", () => ({ awardReferralIfDue: async () => ({ ok: true }) }));

const { claimSubscriptionPayment } = await import("@/lib/billing");
const { churchIdHasFeature, churchPlanLimits, setTierDelta, tierDeltaKey } = await import(
  "@/lib/plan-catalog"
);
const { memberLimitStatus } = await import("@/lib/plan-limits");
const { teamLimitStatus } = await import("@/lib/entitlements-server");

const stamp = Date.now();
const CHURCH = `zzcheck-plans-${stamp}`;
const PLAN = `zzcheck-plan-${stamp}`;
const paymentIds: string[] = [];
let starterDeltaBefore: string | null = null;

beforeAll(async () => {
  await db.insert(customPlan).values({
    id: PLAN,
    slug: PLAN,
    name: `ZZ Student Fellowship ${stamp}`,
    basePlan: "growth",
    priceMonthly: 3000,
    memberLimit: 5,
    teamLimit: 2,
    emailAllowance: 50,
    storageMb: 123,
    featuresAdded: ["finance"],
    featuresRemoved: ["forms"],
  });
  await db.insert(church).values({
    id: CHURCH,
    name: `ZZ Plans ${stamp}`,
    slug: CHURCH,
    handle: CHURCH,
    plan: "growth",
    trialEndsAt: null,
    planRenewsAt: null,
  });
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, tierDeltaKey("starter")));
  starterDeltaBefore = row?.value ?? null;
});

afterAll(async () => {
  // Put the starter ticks back exactly as they were before this ran.
  if (starterDeltaBefore === null)
    await db.delete(platformSetting).where(eq(platformSetting.key, tierDeltaKey("starter")));
  else
    await db
      .update(platformSetting)
      .set({ value: starterDeltaBefore })
      .where(eq(platformSetting.key, tierDeltaKey("starter")));
  for (const id of paymentIds) await db.delete(payment).where(eq(payment.id, id));
  await db.delete(church).where(eq(church.id, CHURCH));
  await db.delete(customPlan).where(eq(customPlan.id, PLAN));
});

async function pay(customPlanId: string | null): Promise<void> {
  const [p] = await db
    .insert(payment)
    .values({
      churchId: CHURCH,
      plan: "growth",
      customPlanId,
      amount: 3000,
      currency: "NGN",
      gateway: "paystack",
      reference: `FI-zzcheck-plans-${stamp}-${paymentIds.length}`,
      status: "pending",
      periodMonths: 1,
    })
    .returning({ id: payment.id });
  paymentIds.push(p.id);
  const claimed = await claimSubscriptionPayment(p.id, {
    allowFailed: false,
    convertRemaining: true,
    actorName: "zzcheck",
  });
  expect(claimed?.customPlanId ?? null).toBe(customPlanId);
}

async function onPlan() {
  const [c] = await db
    .select({ plan: church.plan, customPlanId: church.customPlanId })
    .from(church)
    .where(eq(church.id, CHURCH));
  return c;
}

describe("a custom plan, paid for", () => {
  it("puts the church on it, keeping its base tier in `plan`", async () => {
    await pay(PLAN);
    expect(await onPlan()).toEqual({ plan: "growth", customPlanId: PLAN });
  });

  it("gives exactly its features, not its base tier's", async () => {
    expect(await churchIdHasFeature(CHURCH, "finance")).toBe(true); // added
    expect(await churchIdHasFeature(CHURCH, "forms")).toBe(false); // removed
    expect(await churchIdHasFeature(CHURCH, "training")).toBe(true); // Growth's
  });

  it("enforces its own limits everywhere they are read", async () => {
    const limits = await churchPlanLimits(CHURCH);
    expect(limits).toMatchObject({
      custom: true,
      memberLimit: 5,
      teamLimit: 2,
      emailAllowance: 50,
      storageMb: 123,
    });
    expect((await memberLimitStatus(CHURCH)).limit).toBe(5);
    expect((await teamLimitStatus(CHURCH)).limit).toBe(2);
  });

  it("is left again by paying for a tier", async () => {
    await pay(null);
    expect(await onPlan()).toEqual({ plan: "growth", customPlanId: null });
    expect(await churchIdHasFeature(CHURCH, "finance")).toBe(false);
    expect(await churchIdHasFeature(CHURCH, "forms")).toBe(true);
  });
});

describe("a tier's ticks", () => {
  it("reach a real church on that tier, and come off again", async () => {
    await db.update(church).set({ plan: "starter", customPlanId: null }).where(eq(church.id, CHURCH));
    expect(await churchIdHasFeature(CHURCH, "finance")).toBe(false);

    await setTierDelta("starter", { added: ["finance"], removed: [] });
    expect(await churchIdHasFeature(CHURCH, "finance")).toBe(true);

    await setTierDelta("starter", { added: [], removed: [] });
    expect(await churchIdHasFeature(CHURCH, "finance")).toBe(false);
  });
});
