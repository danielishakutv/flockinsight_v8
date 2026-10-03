import { describe, expect, it } from "vitest";
import {
  featuresFor,
  FEATURES,
  minPlanFor,
  planIncludes,
  planRank,
  PLAN_ORDER,
  teamLimitFor,
  upgradeMessage,
  type FeatureKey,
} from "@/lib/entitlements";
import { PLANS, PLAN_BY_ID } from "@/lib/plans";

/**
 * What each plan includes.
 *
 * Every assertion here is a sentence from the price list. The point is not that
 * the map parses — it is that a church paying for Growth gets Growth, that an
 * unrecognised plan gets the least rather than the most, and that the four tiers
 * stay nested the way "Everything in Growth" claims they are.
 */

describe("plan ranking", () => {
  it("orders the plans the way the price list does", () => {
    expect(PLAN_ORDER).toEqual(["starter", "growth", "pro", "enterprise"]);
    expect(planRank("starter")).toBeLessThan(planRank("growth"));
    expect(planRank("growth")).toBeLessThan(planRank("pro"));
    expect(planRank("pro")).toBeLessThan(planRank("enterprise"));
  });

  it("gives an unknown or missing plan the smallest allowance", () => {
    /*
     * The rule that keeps a bug from becoming a free upgrade. A typo in a plan
     * column, a plan added to the database before it is added to the code — both
     * must land on Starter, never on everything.
     */
    for (const plan of ["", "  ", "SOMETHING", "pro ", "free", null, undefined]) {
      expect(planRank(plan)).toBe(0);
      expect(planIncludes(plan, "finance")).toBe(false);
      expect(planIncludes(plan, "meetings")).toBe(false);
      expect(planIncludes(plan, "members")).toBe(true); // Starter still works
    }
  });
});

describe("what each plan includes", () => {
  it("gives Starter the entry modules and nothing above them", () => {
    expect(planIncludes("starter", "members")).toBe(true);
    expect(planIncludes("starter", "attendance")).toBe(true);
    expect(planIncludes("starter", "giving")).toBe(true);
    expect(planIncludes("starter", "contributions")).toBe(true);
    expect(planIncludes("starter", "events")).toBe(true);

    expect(planIncludes("starter", "meetings")).toBe(false);
    expect(planIncludes("starter", "training")).toBe(false);
    expect(planIncludes("starter", "finance")).toBe(false);
    expect(planIncludes("starter", "sms")).toBe(false);
    expect(planIncludes("starter", "branches")).toBe(false);
  });

  it("gives Growth the meetings tier but not the Pro one", () => {
    expect(planIncludes("growth", "meetings")).toBe(true);
    expect(planIncludes("growth", "training")).toBe(true);
    expect(planIncludes("growth", "forms")).toBe(true);
    expect(planIncludes("growth", "devotionals")).toBe(true);
    expect(planIncludes("growth", "livestreams")).toBe(true);
    expect(planIncludes("growth", "analytics")).toBe(true);

    // The paid upgrades inside meetings, which is the whole reason they are
    // separate keys rather than part of "meetings".
    expect(planIncludes("growth", "meetings.repeat")).toBe(false);
    expect(planIncludes("growth", "meetings.record")).toBe(false);
    expect(planIncludes("growth", "finance")).toBe(false);
    expect(planIncludes("growth", "mediaLibrary")).toBe(false);
    expect(planIncludes("growth", "reports")).toBe(false);
  });

  it("gives Pro everything but the denomination features", () => {
    expect(planIncludes("pro", "finance")).toBe(true);
    expect(planIncludes("pro", "sms")).toBe(true);
    expect(planIncludes("pro", "meetings.repeat")).toBe(true);
    expect(planIncludes("pro", "mediaLibrary")).toBe(true);
    expect(planIncludes("pro", "reports")).toBe(true);
    expect(planIncludes("pro", "branches")).toBe(false);
  });

  it("gives Enterprise everything", () => {
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      expect(planIncludes("enterprise", key)).toBe(true);
    }
  });

  it("nests the tiers, so every plan includes everything below it", () => {
    /*
     * "Everything in Starter", "Everything in Growth", "Everything in Pro" — the
     * price list says this on three cards, so it has to be arithmetically true
     * rather than true by inspection.
     */
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = featuresFor(PLAN_ORDER[i - 1]);
      const higher = featuresFor(PLAN_ORDER[i]);
      for (const f of lower) expect(higher).toContain(f);
      expect(higher.length).toBeGreaterThan(lower.length);
    }
  });
});

describe("every feature is described well enough to charge for", () => {
  it("names a real plan", () => {
    for (const [key, meta] of Object.entries(FEATURES)) {
      expect(PLAN_ORDER, `${key} names a plan that exists`).toContain(meta.plan);
    }
  });

  it("has a label and a sentence saying what you would get", () => {
    for (const [key, meta] of Object.entries(FEATURES)) {
      expect(meta.label.length, `${key} has a label`).toBeGreaterThan(2);
      // A blurb is what somebody reads when they are deciding whether to pay, so
      // it has to be a sentence about the feature, not a restatement of its name.
      expect(meta.blurb.length, `${key} explains itself`).toBeGreaterThan(20);
      expect(meta.blurb.endsWith("."), `${key} blurb is a sentence`).toBe(true);
    }
  });

  it("tells somebody what the feature is and which plan has it", () => {
    const msg = upgradeMessage("finance");
    expect(msg).toContain("Church finance");
    expect(msg).toContain("Pro");
    // Never "not permitted" — that sends somebody to their administrator to ask
    // about a permission they already have.
    expect(msg.toLowerCase()).not.toContain("permission");
    expect(msg.toLowerCase()).not.toContain("denied");
  });

  it("names the plan by the name churches see on the price list", () => {
    expect(upgradeMessage("meetings")).toContain(PLAN_BY_ID.growth.name);
    expect(upgradeMessage("branches")).toContain(PLAN_BY_ID.enterprise.name);
    expect(minPlanFor("meetings.repeat")).toBe("pro");
  });
});

describe("team size", () => {
  it("matches what each plan advertises", () => {
    // Starter says "1 admin account"; Growth says "Up to 10 team members".
    expect(teamLimitFor("starter")).toBe(1);
    expect(teamLimitFor("growth")).toBe(10);
    expect(teamLimitFor("pro")).toBeNull();
    expect(teamLimitFor("enterprise")).toBeNull();
  });

  it("treats an unknown plan as the smallest team", () => {
    expect(teamLimitFor("something-new")).toBe(1);
    expect(teamLimitFor(null)).toBe(1);
  });
});

describe("the map and the price list agree", () => {
  it("has a feature mapped to every plan the price list sells", () => {
    // If a plan existed that nothing was gated to, it would be a tier that buys
    // nothing — worth failing the build over.
    for (const p of PLANS) {
      const mine = (Object.keys(FEATURES) as FeatureKey[]).filter(
        (k) => FEATURES[k].plan === p.id,
      );
      expect(mine.length, `${p.name} includes something of its own`).toBeGreaterThan(0);
    }
  });
});
