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
 * the section I'm in", which a church asked for because seven headings is a
 * lot to read when you only ever use two of them.
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
     * somebody is on must be visible. "Collapse all" closes the other six.
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
