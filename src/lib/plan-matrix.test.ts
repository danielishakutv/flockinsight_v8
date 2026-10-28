import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_FEATURES,
  applyDelta,
  buildCatalog,
  churchHasFeature,
  churchRowHasFeature,
  cleanDelta,
  DEFAULT_CATALOG,
  defaultTierFeatures,
  deltaBetween,
  FEATURES,
  holderFeatures,
  lowestTierWith,
  planChipsFor,
  planIncludes,
  planNameFor,
  upgradeMessage,
  type FeatureKey,
} from "@/lib/entitlements";
import { customPlanKey, parsePlanKey, planKeyOf } from "@/lib/plans";

/**
 * The tick-box catalogue: tiers an admin has changed, and custom plans that
 * start from a tier. The rule every test here circles is that ticks are kept
 * as CHANGES, so whatever the code ships later still lands where it belongs.
 */

const onTier = (plan: string) => ({ plan, customPlanId: null, slug: "grace" });

describe("the defaults", () => {
  it("match the tier each feature ships on, exactly as before", () => {
    for (const k of ALL_FEATURES) {
      for (const tier of ["starter", "growth", "pro", "enterprise"] as const) {
        const before =
          ["starter", "growth", "pro", "enterprise"].indexOf(tier) >=
          ["starter", "growth", "pro", "enterprise"].indexOf(FEATURES[k].plan);
        expect(DEFAULT_CATALOG.tiers[tier].includes(k), `${k} on ${tier}`).toBe(before);
      }
    }
  });

  it("give each higher tier everything the lower one has", () => {
    expect(defaultTierFeatures("growth")).toEqual(
      expect.arrayContaining(defaultTierFeatures("starter")),
    );
    expect(defaultTierFeatures("enterprise")).toEqual(ALL_FEATURES);
  });
});

describe("a tier's ticks", () => {
  const catalog = buildCatalog(
    { starter: { added: ["finance"], removed: ["qrCodes"] } },
    [],
  );

  it("add and remove features on that tier only", () => {
    expect(catalog.tiers.starter).toContain("finance");
    expect(catalog.tiers.starter).not.toContain("qrCodes");
    // Growth is untouched — ticks on one tier do not cascade.
    expect(catalog.tiers.growth).toEqual(DEFAULT_CATALOG.tiers.growth);
  });

  it("are what a church on that tier is held to", () => {
    expect(churchHasFeature(onTier("starter"), "finance", catalog)).toBe(true);
    expect(churchHasFeature(onTier("starter"), "qrCodes", catalog)).toBe(false);
    expect(churchHasFeature(onTier("starter"), "finance", DEFAULT_CATALOG)).toBe(false);
  });

  it("move the upgrade prompt to the lowest tier that now has it", () => {
    expect(lowestTierWith("finance", catalog)).toBe("starter");
    expect(planNameFor("finance", catalog)).toBe("Starter");
    expect(planNameFor("qrCodes", catalog)).toBe("Growth");
  });

  it("say so plainly when no tier has a feature at all", () => {
    const none = buildCatalog(
      {
        starter: { added: [], removed: ["qrCodes"] },
        growth: { added: [], removed: ["qrCodes"] },
        pro: { added: [], removed: ["qrCodes"] },
        enterprise: { added: [], removed: ["qrCodes"] },
      },
      [],
    );
    expect(lowestTierWith("qrCodes", none)).toBeNull();
    expect(upgradeMessage("qrCodes", none)).toMatch(/isn't included in your plan/);
  });
});

describe("storing ticks as changes", () => {
  it("round-trips: the delta between two lists rebuilds the second", () => {
    const base = defaultTierFeatures("growth");
    const target = [...base.filter((k) => k !== "forms"), "finance", "sms"] as FeatureKey[];
    const delta = deltaBetween(base, target);
    expect(delta).toEqual({ added: ["finance", "sms"], removed: ["forms"] });
    expect(new Set(applyDelta(base, delta))).toEqual(new Set(target));
  });

  it("stores nothing for a plan whose boxes all match the default", () => {
    const base = defaultTierFeatures("pro");
    expect(deltaBetween(base, base)).toEqual({ added: [], removed: [] });
  });

  it("lets a feature shipped later land on its tier despite saved ticks", () => {
    // Saved before "finance" existed (pretend): only forms was removed. The
    // delta says nothing about finance, so Pro still gets it by default —
    // the whole reason ticks are not stored as a full list.
    const catalog = buildCatalog({ pro: { added: [], removed: ["forms"] } }, []);
    expect(catalog.tiers.pro).toContain("finance");
    expect(catalog.tiers.pro).not.toContain("forms");
  });

  it("drops keys the code no longer has, and never both adds and removes", () => {
    expect(
      cleanDelta({ added: ["finance", "retiredThing", "finance"], removed: ["finance", "sms", 7] }),
    ).toEqual({ added: ["finance"], removed: ["sms"] });
    expect(cleanDelta(null)).toEqual({ added: [], removed: [] });
    expect(cleanDelta("garbage")).toEqual({ added: [], removed: [] });
  });
});

describe("a custom plan", () => {
  const catalog = buildCatalog({ growth: { added: [], removed: ["livestreams"] } }, [
    {
      id: "fellowship",
      name: "Student Fellowship",
      basePlan: "growth",
      delta: { added: ["finance"], removed: ["pastoralBooking"] },
    },
  ]);
  const fellowship = { plan: "growth", customPlanId: "fellowship", slug: "unilag-fellowship" };

  it("starts from its tier's LIVE list, then applies its own changes", () => {
    const f = holderFeatures(fellowship, catalog);
    expect(f).toContain("finance"); // added on the plan
    expect(f).not.toContain("pastoralBooking"); // removed on the plan
    expect(f).not.toContain("livestreams"); // removed from Growth itself
    expect(f).toContain("training"); // Growth's, untouched
  });

  it("is what the church is held to, not its base tier", () => {
    expect(churchHasFeature(fellowship, "finance", catalog)).toBe(true);
    expect(churchHasFeature(onTier("growth"), "finance", catalog)).toBe(false);
    expect(churchHasFeature(fellowship, "pastoralBooking", catalog)).toBe(false);
  });

  it("falls back to the base tier when the plan is unknown, never to everything", () => {
    const lost = { ...fellowship, customPlanId: "no-such-plan" };
    expect(holderFeatures(lost, catalog)).toEqual(catalog.tiers.growth);
  });

  it("gives an unrecognised base tier the smallest allowance", () => {
    const odd = buildCatalog({}, [
      { id: "x", name: "X", basePlan: "platinum", delta: { added: [], removed: [] } },
    ]);
    expect(odd.custom.x.base).toBe("starter");
    expect(odd.custom.x.features).toEqual(DEFAULT_CATALOG.tiers.starter);
  });

  it("puts chips on exactly what it lacks", () => {
    const chips = planChipsFor(fellowship, catalog);
    expect(chips.finance).toBeUndefined();
    expect(chips.pastoralBooking).toBe("Growth");
    expect(chips.branches).toBe("Enterprise");
  });
});

describe("the demonstration church", () => {
  it("shows every module whatever the ticks say", () => {
    const stripped = buildCatalog(
      { enterprise: { added: [], removed: ["finance"] } },
      [],
    );
    expect(
      churchRowHasFeature(
        { plan: "starter", customPlanId: null, slug: "demo", isDemo: true },
        "finance",
        stripped,
      ),
    ).toBe(true);
  });
});

describe("plan keys", () => {
  it("name a tier or a custom plan, and nothing else", () => {
    expect(parsePlanKey("growth")).toEqual({ tier: "growth" });
    expect(parsePlanKey(customPlanKey("abc"))).toEqual({ customId: "abc" });
    expect(parsePlanKey("custom:")).toBeNull();
    expect(parsePlanKey("platinum")).toBeNull();
    expect(parsePlanKey(null)).toBeNull();
  });

  it("follow the custom plan when a church has one", () => {
    expect(planKeyOf({ plan: "growth", customPlanId: null })).toBe("growth");
    expect(planKeyOf({ plan: "growth", customPlanId: "abc" })).toBe("custom:abc");
  });
});

/*
 * The trap this whole design exists to avoid, guarded at the source: a check
 * that reads the CODE's defaults instead of the live catalogue compiles,
 * runs, and enforces the wrong thing without a word. The church checks take
 * the catalogue as a required argument, so the compiler catches those; the
 * helpers below default it (the tests need them to), so this catches them.
 */
describe("product code reads the live catalogue", () => {
  const root = path.join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.(test|db-check)\.ts$/.test(name)) files.push(p);
    }
  };
  walk(root);
  const offenders = (re: RegExp, allow: string[] = []) =>
    files
      .filter((f) => !allow.some((a) => f.replaceAll("\\", "/").endsWith(a)))
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));

  it("never asks a tier with the code's defaults", () => {
    expect(offenders(/\bplanIncludes\(/, ["src/lib/entitlements.ts"])).toEqual([]);
    expect(offenders(/\bfeaturesFor\(/, ["src/lib/entitlements.ts"])).toEqual([]);
    expect(
      offenders(/\bcanRepeatMeetings\(/, ["src/lib/meetings-shared.ts"]),
    ).toEqual([]);
  });

  it("names the plan in a prompt from the live catalogue", () => {
    // One argument means the default catalogue.
    expect(
      offenders(/\b(planNameFor|upgradeMessage)\(\s*[^,()]+\)/, ["src/lib/entitlements.ts"]),
    ).toEqual([]);
  });

  it("has planIncludes agree with the defaults it is kept for", () => {
    expect(planIncludes("growth", "training")).toBe(true);
    expect(planIncludes("growth", "finance")).toBe(false);
  });
});
