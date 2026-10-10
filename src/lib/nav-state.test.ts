import { describe, expect, it } from "vitest";
import {
  allClosed,
  parseGroupMode,
  resolveOpenGroups,
  type NavGroup,
} from "@/lib/nav-state";

/**
 * How much of the menu is open.
 *
 * The manual half of this is tested in `admin-nav.test.ts`, which is where it
 * started. What is here is the mode: "expand all", "collapse all" and "only
 * the section I'm in", which a church asked for because six headings is a lot
 * to read when you only ever use two of them.
 */

const groups: NavGroup[] = [
  { title: "Services", hrefs: ["/attendance", "/my-events"] },
  { title: "Money", hrefs: ["/giving", "/finance"] },
  { title: "People", hrefs: ["/members"] },
];

describe("parseGroupMode", () => {
  it("defaults to manual for anything it does not recognise", () => {
    for (const raw of [null, undefined, "", "yes", "FOCUS", "{}"]) {
      expect(parseGroupMode(raw), String(raw)).toBe("manual");
    }
  });

  it("reads focus", () => {
    expect(parseGroupMode("focus")).toBe("focus");
  });
});

describe("collapse all", () => {
  it("names every group", () => {
    expect(allClosed(groups)).toEqual(["Services", "Money", "People"]);
  });

  it("still leaves the group you are reading open", () => {
    /*
     * Deliberate, and the same rule as everywhere else: the entry for the page
     * somebody is on must be visible. "Collapse all" closes the other five.
     */
    const open = resolveOpenGroups(groups, allClosed(groups), "/giving");
    expect([...open]).toEqual(["Money"]);
  });

  it("closes everything when the page is not in the menu at all", () => {
    const open = resolveOpenGroups(groups, allClosed(groups), undefined);
    expect(open.size).toBe(0);
  });
});

describe("focus mode", () => {
  it("opens only the group holding the current page", () => {
    const open = resolveOpenGroups(groups, [], "/members", "focus");
    expect([...open]).toEqual(["People"]);
  });

  it("ignores what was collapsed in manual mode rather than merging it", () => {
    /*
     * Merging would make "only the section I'm in" mean "that one, plus
     * whatever you happened to have open the other way round", which is
     * neither thing. Money is closed in the stored list and still the only
     * one open, because that is where the page is.
     */
    const open = resolveOpenGroups(groups, ["Money"], "/finance", "focus");
    expect([...open]).toEqual(["Money"]);
  });

  it("falls back to the first group when the page is not in the menu", () => {
    /*
     * The strict reading — nothing open — is a sidebar that looks broken and
     * says nothing about why, and plenty of real pages are not menu entries:
     * /profile, one member's record, a meeting room.
     */
    const open = resolveOpenGroups(groups, [], "/profile", "focus");
    expect([...open]).toEqual(["Services"]);
  });

  it("opens nothing when there are no groups", () => {
    expect(resolveOpenGroups([], [], "/members", "focus").size).toBe(0);
  });

  it("moves as the page moves", () => {
    const here = (active: string) => [
      ...resolveOpenGroups(groups, [], active, "focus"),
    ];
    expect(here("/attendance")).toEqual(["Services"]);
    expect(here("/giving")).toEqual(["Money"]);
    expect(here("/members")).toEqual(["People"]);
  });
});

/*
 * A heading pressed by hand while the menu is following the page.
 *
 * This is what focus mode was missing. There was no way to look inside
 * another group without the press turning the whole setting off, so a glance
 * cost the preference, and nothing on screen said it had. Now the press moves
 * the one open group and the mode survives it.
 *
 * What is tested here is the RULE: given a glance, which group is open. How
 * long a glance lasts is the sidebar's, because it is a lifetime and not a
 * lookup — the component drops it when the path changes, and anything pure
 * enough to test here would have to be a comparison against the current page,
 * which is the bug: it suspends the glance while you are away and revives it
 * when you come back. It is covered from the outside instead, by the browser
 * harness that drives a real build.
 */
describe("a group opened by hand while following the page", () => {
  it("wins over the group holding the page", () => {
    const open = resolveOpenGroups(groups, [], "/members", "focus", "Money");
    expect([...open]).toEqual(["Money"]);
  });

  it("is still only one group", () => {
    const open = resolveOpenGroups(groups, [], "/members", "focus", "Services");
    expect(open.size).toBe(1);
  });

  it("is ignored when it names a group that is no longer there", () => {
    /*
     * A module can leave the menu between the press and the render — a plan
     * lapses, a permission is withdrawn, somebody switches church. Honouring
     * the name would open nothing at all, and an empty sidebar is the one
     * state this mode must never produce.
     */
    const open = resolveOpenGroups(groups, [], "/members", "focus", "Media");
    expect([...open]).toEqual(["People"]);
  });

  it("goes back to the page once the glance is dropped", () => {
    const peeked = resolveOpenGroups(groups, [], "/members", "focus", "Money");
    const after = resolveOpenGroups(groups, [], "/members", "focus", null);
    expect([...peeked]).toEqual(["Money"]);
    expect([...after]).toEqual(["People"]);
  });

  it("means nothing in manual mode, where the closed list decides", () => {
    /*
     * The glance only exists because focus mode has exactly one open group to
     * move. In manual mode every group has its own remembered state and a
     * stray value must not quietly override it.
     */
    const open = resolveOpenGroups(groups, ["Money"], "/members", "manual", "Money");
    expect([...open].sort()).toEqual(["People", "Services"]);
  });
});
