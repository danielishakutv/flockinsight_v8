import { describe, expect, it } from "vitest";
import {
  activeHref,
  groupOf,
  resolveOpenGroups,
  toggleClosed,
  type NavGroup,
} from "@/lib/admin-nav";

const groups: NavGroup[] = [
  { title: "Overview", hrefs: ["/superadmin", "/superadmin/health", "/superadmin/insights"] },
  { title: "Customers", hrefs: ["/superadmin/churches", "/superadmin/users"] },
  { title: "Growth", hrefs: ["/superadmin/growth", "/superadmin/growth/outreach"] },
];

describe("activeHref", () => {
  it("lights the longest match, not every prefix", () => {
    // /growth/outreach must not also light /growth.
    expect(activeHref("/superadmin/growth/outreach", groups.flatMap((g) => g.hrefs))).toBe(
      "/superadmin/growth/outreach",
    );
  });

  it("matches the dashboard exactly", () => {
    // "/superadmin" prefixes every page in the admin, so a prefix match would
    // leave the dashboard lit everywhere.
    const hrefs = groups.flatMap((g) => g.hrefs);
    expect(activeHref("/superadmin", hrefs)).toBe("/superadmin");
    expect(activeHref("/superadmin/churches", hrefs)).toBe("/superadmin/churches");
  });

  it("lights a parent for a page below it", () => {
    expect(activeHref("/superadmin/churches/abc123", groups.flatMap((g) => g.hrefs))).toBe(
      "/superadmin/churches",
    );
  });

  it("returns nothing for a path outside the admin", () => {
    expect(activeHref("/dashboard", groups.flatMap((g) => g.hrefs))).toBeUndefined();
  });
});

describe("resolveOpenGroups", () => {
  it("opens everything for somebody who has never collapsed anything", () => {
    expect(resolveOpenGroups(groups, [], undefined).size).toBe(3);
  });

  it("keeps a group the person collapsed collapsed", () => {
    const open = resolveOpenGroups(groups, ["Customers"], undefined);
    expect(open.has("Customers")).toBe(false);
    expect(open.has("Overview")).toBe(true);
  });

  it("opens a group that did not exist when they last visited", () => {
    // The stored list is of CLOSED groups, so a new one is absent and
    // therefore open. Storing open groups instead would hide every section
    // added in a later release.
    const withNew = [...groups, { title: "Messaging", hrefs: ["/superadmin/notifications"] }];
    expect(resolveOpenGroups(withNew, ["Customers"], undefined).has("Messaging")).toBe(true);
  });

  it("always opens the group holding the current page", () => {
    // Otherwise following a link from elsewhere lands you on a page whose own
    // menu entry is invisible.
    const open = resolveOpenGroups(groups, ["Customers"], "/superadmin/churches");
    expect(open.has("Customers")).toBe(true);
  });

  it("survives a group disappearing when a permission is revoked", () => {
    const fewer = groups.slice(0, 2);
    const open = resolveOpenGroups(fewer, ["Growth", "Customers"], undefined);
    expect([...open]).toEqual(["Overview"]);
  });
});

describe("groupOf", () => {
  it("finds the group holding a page", () => {
    expect(groupOf(groups, "/superadmin/users")).toBe("Customers");
  });

  it("is undefined when nothing is active", () => {
    expect(groupOf(groups, undefined)).toBeUndefined();
  });
});

describe("toggleClosed", () => {
  it("closes an open group and reopens a closed one", () => {
    expect(toggleClosed([], "Money")).toEqual(["Money"]);
    expect(toggleClosed(["Money"], "Money")).toEqual([]);
  });

  it("leaves the other groups alone", () => {
    expect(toggleClosed(["Money"], "Growth").sort()).toEqual(["Growth", "Money"]);
  });
});
