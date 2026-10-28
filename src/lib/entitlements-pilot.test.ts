import { describe, expect, it } from "vitest";
import {
  FEATURES,
  PILOT_ONLY,
  churchHasFeature,
  isPilot,
  pilotAllows,
  planIncludes,
  DEFAULT_CATALOG,
  type PilotMap,
} from "@/lib/entitlements";
import { navVisible } from "@/lib/nav";

/** A church on a tier, with no custom plan. */
const h = (plan: string, slug: string) => ({ plan, customPlanId: null, slug });

/**
 * Shipping a module to one church first.
 *
 * A finished module that has never met a real church is not ready for every
 * church. The pilot list is how one gets tried somewhere, and the thing worth
 * testing is that it is a NARROWING — it can only ever take access away, never
 * hand a module to a plan that does not include it.
 *
 * Most of these run against a MADE-UP pilot map rather than the real one,
 * because the real one is empty most of the time. Testing only the live map
 * would mean the gate loses its coverage the moment a pilot ends, and the next
 * person to reach for it would be trusting code nothing had exercised in
 * months. The map is injectable precisely so this file does not rot.
 */

/** A pilot that does not exist, so these tests hold whatever is live. */
const PRETEND: PilotMap = { facilities: ["pilot-church"] };

describe("the pilot list", () => {
  it("names only real features", () => {
    for (const key of Object.keys(PILOT_ONLY)) {
      expect(FEATURES[key as keyof typeof FEATURES], key).toBeDefined();
    }
  });

  it("is empty — facilities was opened to every church on 2026-10-07", () => {
    /*
     * The live map, asserted as a fact rather than a shape. If something is
     * added here on purpose this fails and whoever added it writes the line
     * saying which church and why; a pilot nobody remembers starting is how a
     * module stays invisible to paying churches for months.
     */
    expect(PILOT_ONLY).toEqual({});
    expect(isPilot("facilities")).toBe(false);
  });

  it("leaves everything that is not a pilot completely alone", () => {
    expect(isPilot("members")).toBe(false);
    expect(pilotAllows("members", "any-church")).toBe(true);
    // Including for a church it cannot even name.
    expect(pilotAllows("members", null)).toBe(true);
  });

  it("lets every church reach facilities now that the pilot has ended", () => {
    for (const slug of ["flockinsight-church", "some-other-church", null]) {
      expect(pilotAllows("facilities", slug), String(slug)).toBe(true);
    }
    // Still Pro, though. Ending a pilot is not a free upgrade either.
    expect(churchHasFeature(h("pro", "some-other-church"), "facilities", DEFAULT_CATALOG)).toBe(true);
    expect(churchHasFeature(h("growth", "some-other-church"), "facilities", DEFAULT_CATALOG)).toBe(false);
  });
});

describe("who a pilot lets in", () => {
  it("lets the named church through", () => {
    expect(pilotAllows("facilities", "flockinsight-church")).toBe(true);
  });

  it("keeps every other church out, however much they pay", () => {
    expect(pilotAllows("facilities", "another-church", PRETEND)).toBe(false);
    expect(
      churchHasFeature(h("enterprise", "another-church"), "facilities", DEFAULT_CATALOG, PRETEND),
    ).toBe(false);
  });

  it("refuses a church it cannot name, rather than waving it through", () => {
    // The same reading as planRank's unknown plan: not knowing is the smaller
    // allowance, never the larger.
    for (const slug of [null, undefined, ""]) {
      expect(pilotAllows("facilities", slug, PRETEND), String(slug)).toBe(false);
    }
  });
});

describe("a pilot narrows, it never widens", () => {
  it("still refuses the pilot church if its plan is too low", () => {
    // facilities is Pro. Being in the pilot is not a free upgrade.
    expect(planIncludes("starter", "facilities")).toBe(false);
    expect(churchHasFeature(h("starter", "pilot-church"), "facilities", DEFAULT_CATALOG, PRETEND)).toBe(false);
    expect(churchHasFeature(h("growth", "pilot-church"), "facilities", DEFAULT_CATALOG, PRETEND)).toBe(false);
  });

  it("allows it only when BOTH agree", () => {
    expect(churchHasFeature(h("pro", "pilot-church"), "facilities", DEFAULT_CATALOG, PRETEND)).toBe(true);
    expect(churchHasFeature(h("enterprise", "pilot-church"), "facilities", DEFAULT_CATALOG, PRETEND)).toBe(true);
  });

  it("changes nothing for an ordinary feature", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"]) {
      expect(churchHasFeature(h(plan, "anybody"), "members", DEFAULT_CATALOG, PRETEND)).toBe(
        planIncludes(plan, "members"),
      );
    }
  });
});

describe("what the nav shows", () => {
  const item = { perm: "facilities.view", feature: "facilities" } as const;
  const perms = ["facilities.view"];

  it("shows a piloted module to the pilot church", () => {
    expect(navVisible(item, perms, false, "pilot-church", PRETEND)).toBe(true);
  });

  it("HIDES it from everyone else rather than showing an upgrade chip", () => {
    /*
     * The chip would say "Pro", and during a pilot paying for Pro would not
     * unlock it. Advertising it would be a promise the product cannot keep.
     */
    expect(navVisible(item, perms, false, "another-church", PRETEND)).toBe(false);
  });

  it("hides it from an owner too — ownership is not a pilot pass", () => {
    expect(navVisible(item, [], true, "another-church", PRETEND)).toBe(false);
  });

  it("still hides anything the person has no permission for", () => {
    expect(navVisible(item, [], false, "pilot-church", PRETEND)).toBe(false);
  });

  it("leaves a non-piloted module showing for everybody who may see it", () => {
    const members = { perm: "members.view", feature: "members" } as const;
    expect(navVisible(members, ["members.view"], false, "any-church")).toBe(true);
    expect(navVisible(members, ["members.view"], false, null)).toBe(true);
  });

  it("shows Facilities to every church now, against the LIVE map", () => {
    // No PRETEND here on purpose: this is the thing the user asked for, so it
    // is asserted against what actually ships.
    expect(navVisible(item, perms, false, "any-church-at-all")).toBe(true);
    expect(navVisible(item, perms, false, null)).toBe(true);
  });
});
