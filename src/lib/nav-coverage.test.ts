import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navSections, visibleNavItems } from "@/lib/nav";

/**
 * A module with no way to reach it.
 *
 * The navigation used to be TWO lists — one the sidebar and the mobile menu
 * both rendered, and `mainNav`, which was read by nothing at all. Nothing said
 * so and nothing checked, so a module added to `mainNav` was simply invisible:
 * no error, no warning, no empty page, just a feature that was not there.
 *
 * It cost three. Facilities and First-timers were built, tested, deployed and
 * verified in that state and never once appeared in the app; the feature flag
 * took the blame. Livestreams had been invisible for longer, and this file
 * found it.
 *
 * `mainNav` is gone. `navSections` is the only list. These tests are what
 * stops the next one.
 */

const renderedHrefs = navSections.flatMap((s) => s.items.map((i) => i.href));

describe("the navigation", () => {
  it("names each route once", () => {
    const dupes = renderedHrefs.filter((h, i) => renderedHrefs.indexOf(h) !== i);
    expect(dupes, `listed twice: ${dupes.join(", ")}`).toEqual([]);
  });

  it("points every entry at a page that exists", () => {
    const appDir = join(import.meta.dirname, "..", "app", "(app)");
    const dirs = readdirSync(appDir).filter((d) =>
      statSync(join(appDir, d)).isDirectory(),
    );
    for (const href of renderedHrefs) {
      const top = href.replace(/^\//, "").split("/")[0];
      expect(dirs.includes(top), `${href} has no page under app/(app)`).toBe(true);
    }
  });
});

/**
 * The grouping, as a claim that can fail.
 *
 * The regrouping exists because "Records" had grown to eleven entries — Giving
 * beside Media beside QR codes — and at eleven a heading has stopped helping:
 * it is a list with a word on top of it, and finding Finance meant reading all
 * eleven. Nothing stops that happening again except a number somewhere, so
 * here is the number. Seven is the point at which the next person should split
 * the group rather than add to it.
 */
describe("the grouping", () => {
  it("keeps every group scannable at a glance", () => {
    for (const section of navSections) {
      expect(
        section.items.length,
        `${section.titleKey} has ${section.items.length} entries. ` +
          `Past seven a heading stops helping — split the group instead.`,
      ).toBeLessThanOrEqual(7);
      expect(section.items.length, `${section.titleKey} is empty`).toBeGreaterThan(0);
    }
  });

  /*
   * Exactly one footer section, and it is last.
   *
   * The sidebar renders `footer` sections below its scroll area and the rest
   * inside it. Two of them would silently split Settings and Help across the
   * two halves of the sidebar; one in the middle of the list would render out
   * of order on mobile, where the sheet shows them all inline.
   */
  it("pins exactly one section to the bottom, and it is the last", () => {
    const footers = navSections.filter((s) => s.footer);
    expect(footers.length).toBe(1);
    expect(navSections[navSections.length - 1].footer).toBe(true);
  });
});

/**
 * What the sidebar would actually render.
 *
 * The structural tests above would have caught the original bug, but only
 * because the entry was in the wrong list. This models the real render path —
 * the sidebar, the mobile menu and the palette all call `visibleNavItems` — so
 * a module lost to a permission typo, a pilot nobody remembers, or a feature
 * key that does not match also fails here.
 *
 * Checking that a route merely BUILDS is what let three modules ship
 * invisible. A route can build perfectly and still be unreachable.
 */
function whatTheSidebarShows(
  perms: string[],
  isOwner: boolean,
  churchSlug: string | null,
): string[] {
  return visibleNavItems(perms, isOwner, churchSlug).map((i) => i.href);
}

describe("what an owner actually sees", () => {
  const shown = whatTheSidebarShows([], true, "any-church");

  for (const href of ["/facilities", "/first-timers", "/livestreams"]) {
    it(`renders ${href}`, () => {
      expect(
        shown.includes(href),
        `${href} does not survive the sidebar's own filter, so it is invisible ` +
          `in the app however well the route builds.`,
      ).toBe(true);
    });
  }

  it("renders every module, for an owner of any church", () => {
    for (const href of MODULES_THAT_NEED_A_LINK) {
      expect(shown.includes(href), href).toBe(true);
    }
  });

  /*
   * Including the three below the scroll. `visibleNavItems` flattens every
   * section, footer or not — if it ever stops doing that, Settings and Help
   * drop out of the palette and out of the mobile sheet without a word.
   */
  it("renders the pinned footer entries too", () => {
    for (const href of ["/settings", "/help", "/notifications"]) {
      expect(shown.includes(href), href).toBe(true);
    }
  });
});

describe("what a limited team member sees", () => {
  it("shows Facilities to somebody with facilities.view and nothing else", () => {
    const shown = whatTheSidebarShows(["facilities.view"], false, "any-church");
    expect(shown).toContain("/facilities");
  });

  it("hides it from somebody without that permission", () => {
    const shown = whatTheSidebarShows(["members.view"], false, "any-church");
    expect(shown).not.toContain("/facilities");
    expect(shown).toContain("/members");
  });
});

/**
 * Every page under `(app)` can be reached.
 *
 * A route with no link is not necessarily a bug — plenty are reached from
 * inside another page — so this only checks the ones that are modules in their
 * own right, listed here deliberately. Adding a module means adding a line
 * below, which is the moment to notice it also needs a nav entry.
 */
const MODULES_THAT_NEED_A_LINK = [
  "/dashboard",
  "/members",
  "/groups",
  "/attendance",
  "/giving",
  "/finance",
  "/contributions",
  "/follow-up",
  "/first-timers",
  "/facilities",
  "/training",
  "/meetings",
  "/media",
  "/forms",
  "/links",
  "/devotionals",
  "/communication",
  "/reports",
  "/analytics",
  "/celebrations",
  "/settings",
];

describe("every module is reachable", () => {
  for (const href of MODULES_THAT_NEED_A_LINK) {
    it(`${href} has a nav entry`, () => {
      expect(
        renderedHrefs.includes(href),
        `${href} is a module with no way to reach it from the navigation.`,
      ).toBe(true);
    });
  }

  it("and every module listed above actually exists as a page", () => {
    const appDir = join(import.meta.dirname, "..", "app", "(app)");
    const dirs = readdirSync(appDir).filter((d) =>
      statSync(join(appDir, d)).isDirectory(),
    );
    for (const href of MODULES_THAT_NEED_A_LINK) {
      const top = href.replace(/^\//, "").split("/")[0];
      expect(dirs.includes(top), `${href} has no page under app/(app)`).toBe(true);
    }
  });
});
