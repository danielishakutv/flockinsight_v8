import { describe, expect, it } from "vitest";
import {
  FEATURES,
  PILOT_ONLY,
  churchHasFeature,
  isPilot,
  pilotAllows,
  planIncludes,
} from "@/lib/entitlements";
import { navVisible } from "@/lib/nav";

/**
 * Shipping a module to one church first.
 *
 * A finished module that has never met a real church is not ready for every
 * church. The pilot list is how one gets tried somewhere, and the thing worth
 * testing is that it is a NARROWING — it can only ever take access away, never
 * hand a module to a plan that does not include it.
 */

describe("the pilot list", () => {
  it("names only real features", () => {
    for (const key of Object.keys(PILOT_ONLY)) {
      expect(FEATURES[key as keyof typeof FEATURES], key).toBeDefined();
    }
  });

  it("has facilities at FlockInsight Church and nowhere else, for now", () => {
    expect(PILOT_ONLY.facilities).toEqual(["flockinsight-church"]);
    expect(isPilot("facilities")).toBe(true);
  });

  it("leaves everything that is not a pilot completely alone", () => {
    expect(isPilot("members")).toBe(false);
    expect(pilotAllows("members", "any-church")).toBe(true);
    // Including for a church it cannot even name.
    expect(pilotAllows("members", null)).toBe(true);
  });
});

describe("who a pilot lets in", () => {
  it("lets the named church through", () => {
    expect(pilotAllows("facilities", "flockinsight-church")).toBe(true);
  });

  it("keeps every other church out, however much they pay", () => {
    expect(pilotAllows("facilities", "redeemed-peoples-mission-magami")).toBe(false);
    expect(churchHasFeature("enterprise", "some-other-church", "facilities")).toBe(false);
  });

  it("refuses a church it cannot name, rather than waving it through", () => {
    // The same reading as planRank's unknown plan: not knowing is the smaller
    // allowance, never the larger.
    expect(pilotAllows("facilities", null)).toBe(false);
    expect(pilotAllows("facilities", undefined)).toBe(false);
    expect(pilotAllows("facilities", "")).toBe(false);
  });
});

describe("a pilot narrows, it never widens", () => {
  it("still refuses the pilot church if its plan is too low", () => {
    // facilities is Pro. Being in the pilot is not a free upgrade.
    expect(planIncludes("starter", "facilities")).toBe(false);
    expect(churchHasFeature("starter", "flockinsight-church", "facilities")).toBe(false);
    expect(churchHasFeature("growth", "flockinsight-church", "facilities")).toBe(false);
  });

  it("allows it only when BOTH agree", () => {
    expect(churchHasFeature("pro", "flockinsight-church", "facilities")).toBe(true);
    expect(churchHasFeature("enterprise", "flockinsight-church", "facilities")).toBe(true);
  });

  it("changes nothing for an ordinary feature", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"]) {
      expect(churchHasFeature(plan, "anybody", "members")).toBe(
        planIncludes(plan, "members"),
      );
    }
  });
});

describe("what the nav shows", () => {
  const item = { perm: "facilities.view", feature: "facilities" } as const;
  const perms = ["facilities.view"];

  it("shows a piloted module to the pilot church", () => {
    expect(navVisible(item, perms, false, "flockinsight-church")).toBe(true);
  });

  it("HIDES it from everyone else rather than showing an upgrade chip", () => {
    /*
     * The chip would say "Pro", and during a pilot paying for Pro would not
     * unlock it. Advertising it would be a promise the product cannot keep.
     */
    expect(navVisible(item, perms, false, "another-church")).toBe(false);
  });

  it("hides it from an owner too — ownership is not a pilot pass", () => {
    expect(navVisible(item, [], true, "another-church")).toBe(false);
  });

  it("still hides anything the person has no permission for", () => {
    expect(navVisible(item, [], false, "flockinsight-church")).toBe(false);
  });

  it("leaves a non-piloted module showing for everybody who may see it", () => {
    const members = { perm: "members.view", feature: "members" } as const;
    expect(navVisible(members, ["members.view"], false, "any-church")).toBe(true);
    expect(navVisible(members, ["members.view"], false, null)).toBe(true);
  });
});
