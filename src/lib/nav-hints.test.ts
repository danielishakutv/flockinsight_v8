import { describe, expect, it } from "vitest";
import { hintedHrefs, navKeyHints } from "@/lib/nav-hints";
import { navSections } from "@/lib/nav";
import { SHORTCUTS } from "@/lib/shortcuts";

/**
 * The keys printed beside the menu entries.
 *
 * The failure this guards is quiet and embarrassing: a shortcut's address is
 * changed or retired, the sidebar goes on printing "G B" beside Facilities,
 * and somebody presses it for a fortnight before concluding the app is broken.
 * The hints are generated from the registry precisely so that cannot happen,
 * and this is the test that says the two still line up.
 */

const menuHrefs = new Set(navSections.flatMap((s) => s.items.map((i) => i.href)));

describe("the printed keys", () => {
  it("only advertises destinations that are actually in the menu", () => {
    for (const href of hintedHrefs()) {
      expect(
        menuHrefs.has(href),
        `a "go" shortcut points at ${href}, which is not a menu entry — the ` +
          `hint would be printed on no row, or on the wrong one.`,
      ).toBe(true);
    }
  });

  it("prints one key per press, so a sequence cannot read as a chord", () => {
    const hints = navKeyHints(false);
    expect(hints["/members"]).toEqual(["G", "M"]);
    expect(hints["/attendance"]).toEqual(["G", "A"]);
  });

  it("says ⌘ on a Mac", () => {
    /*
     * None of the `go` shortcuts is a chord today, so this is really a check
     * that the platform is being passed through at all rather than defaulted.
     */
    expect(navKeyHints(true)["/giving"]).toEqual(["G", "G"]);
  });

  it("leaves out the forms, which are a different promise", () => {
    /*
     * "N M" beside Members would read as the key for opening Members, which
     * it is not: it opens the Add member form. The palette teaches those.
     */
    const hints = navKeyHints(false);
    for (const href of Object.keys(hints)) {
      expect(href.includes("?"), href).toBe(false);
    }
    expect(Object.keys(hints)).not.toContain("/attendance/record");
  });

  it("covers every destination shortcut and nothing else", () => {
    const expected = SHORTCUTS.filter((s) => s.group === "go").length;
    expect(Object.keys(navKeyHints(false))).toHaveLength(expected);
  });
});
