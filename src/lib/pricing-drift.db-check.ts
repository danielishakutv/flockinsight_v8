/**
 * Database-backed checks for stale pricing copy. Run with `pnpm test:db`.
 *
 * These exist because of a bug with no error message and no symptom anybody
 * would report: the live pricing page spent months advertising a member limit
 * and a feature set from long before, and not one module shipped in between ever
 * appeared on it. Nothing was broken. Somebody had once pressed Save on a
 * feature list, which pins it for ever, and after that the code was simply not
 * what the website said.
 *
 * So what is asserted here is not "features save correctly" — it is that the
 * platform can TELL when its own price list has stopped describing it, and can
 * be handed back to the code without losing the allowances an operator tuned
 * against a real supplier bill.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAN_BY_ID } from "@/lib/plans";
import {
  getPlanEmails,
  getPlanFeatures,
  getPlanStorageMb,
  planFeatureDrift,
  resetPlanFeatures,
  setPlanEmails,
  setPlanFeatures,
  setPlanStorageMb,
} from "@/lib/pricing";
import { getSetting, setSetting } from "@/lib/platform-settings";

/*
 * Enterprise, on purpose: it is the one plan with no price to disturb, and the
 * least likely to be mid-edit by a real operator while this runs.
 */
const PLAN = "enterprise" as const;
const FEATURES_KEY = `plan_features_${PLAN}`;
const STORAGE_KEY = `plan_storage_mb_${PLAN}`;
const EMAILS_KEY = `plan_emails_${PLAN}`;

let saved = { features: "", storage: "", emails: "" };

beforeAll(async () => {
  // Whatever the operator really has, kept so this file puts it back exactly.
  saved = {
    features: await getSetting(FEATURES_KEY, ""),
    storage: await getSetting(STORAGE_KEY, ""),
    emails: await getSetting(EMAILS_KEY, ""),
  };
});

afterAll(async () => {
  await setSetting(FEATURES_KEY, saved.features);
  await setSetting(STORAGE_KEY, saved.storage);
  await setSetting(EMAILS_KEY, saved.emails);
});

describe("the platform notices when its price list stops describing it", () => {
  it("reports no drift when a plan is following the app", async () => {
    await resetPlanFeatures(PLAN);
    const d = await planFeatureDrift(PLAN);

    expect(d.overridden).toBe(false);
    expect(d.missing).toEqual([]);
    expect(d.live).toEqual(PLAN_BY_ID[PLAN].features);
  });

  it("names every bullet a saved list is not telling churches about", async () => {
    /*
     * The shape of the real bug: an old list, saved once, that never mentioned
     * meetings, training, contributions, forms or anything else that came after
     * it. A count alone would not have made anybody act — reading the sentences
     * is what does.
     */
    await setPlanFeatures(PLAN, ["Everything in Pro", "A thing from two years ago"]);

    const d = await planFeatureDrift(PLAN);
    expect(d.overridden).toBe(true);
    expect(d.live).toEqual(["Everything in Pro", "A thing from two years ago"]);
    expect(d.missing.length).toBeGreaterThan(0);
    // "Everything in Pro" is in both, so it is not missing; the rest are.
    expect(d.missing).not.toContain("Everything in Pro");
    for (const m of d.missing) expect(PLAN_BY_ID[PLAN].features).toContain(m);
  });

  it("ignores case when deciding what is missing", async () => {
    // An operator who retyped a bullet in different case has not lost it, and
    // telling them they had would train them to ignore this panel.
    const first = PLAN_BY_ID[PLAN].features[0];
    await setPlanFeatures(PLAN, [first.toUpperCase()]);

    const d = await planFeatureDrift(PLAN);
    expect(d.missing).not.toContain(first);
  });

  it("treats an unreadable override as no override, like every other reader", async () => {
    // Half-written JSON in a settings row must not take the pricing page down.
    await setSetting(FEATURES_KEY, "{not json");

    const d = await planFeatureDrift(PLAN);
    expect(d.live).toEqual(PLAN_BY_ID[PLAN].features);
    expect(d.missing).toEqual([]);
    // And the page itself still renders the built-in list.
    expect(await getPlanFeatures(PLAN)).toEqual(PLAN_BY_ID[PLAN].features);
  });
});

describe("handing a plan back to the app", () => {
  it("restores the built-in list", async () => {
    await setPlanFeatures(PLAN, ["Stale"]);
    expect(await getPlanFeatures(PLAN)).toEqual(["Stale"]);

    await resetPlanFeatures(PLAN);

    expect(await getPlanFeatures(PLAN)).toEqual(PLAN_BY_ID[PLAN].features);
    expect((await planFeatureDrift(PLAN)).overridden).toBe(false);
  });

  it("leaves the storage and email allowances exactly as they were", async () => {
    /*
     * The reason this is separate from the reset that clears everything. Those
     * two numbers are what the supplier bill is made of; an operator who tuned
     * them the day Cloudinary moved its prices must not lose them to fix a
     * sentence on a marketing page.
     */
    await setPlanStorageMb(PLAN, 12345);
    await setPlanEmails(PLAN, 777);
    await setPlanFeatures(PLAN, ["Stale"]);

    await resetPlanFeatures(PLAN);

    expect(await getPlanStorageMb(PLAN)).toBe(12345);
    expect(await getPlanEmails(PLAN)).toBe(777);
  });
});
