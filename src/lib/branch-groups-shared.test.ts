import { describe, expect, it } from "vitest";
import {
  bandPath,
  bandWithDescendants,
  buildBandTree,
  canReparent,
  flattenBandTree,
  type BandNode,
} from "@/lib/branch-groups-shared";

/**
 * A network's filing system, which has to hold two properties or it is worse
 * than no filing system at all:
 *
 *   a filter on a band includes everything underneath it, or a national report
 *   shows nothing, because churches are filed at the bottom and reports are
 *   read from the top;
 *
 *   and it cannot contain a loop, because a loop is a page that never finishes
 *   rendering and a total that never finishes counting.
 */

const band = (
  id: string,
  parentId: string | null,
  name = id,
  sort = 0,
  kind = "Group",
): BandNode => ({ id, parentId, name, kind, sort });

/** Nigeria → North Central → Jos District, plus a second national band. */
const NETWORK: BandNode[] = [
  band("ng", null, "Nigeria", 0, "National"),
  band("nc", "ng", "North Central", 0, "Zonal"),
  band("sw", "ng", "South West", 1, "Zonal"),
  band("jos", "nc", "Jos District", 0, "District"),
  band("abj", "nc", "Abuja District", 1, "District"),
  band("gh", null, "Ghana", 1, "National"),
];

describe("building the tree", () => {
  it("nests each band under its parent and records how deep it sits", () => {
    const tree = buildBandTree(NETWORK);
    expect(tree.map((t) => t.id)).toEqual(["ng", "gh"]);

    const ng = tree[0];
    expect(ng.depth).toBe(0);
    expect(ng.children.map((c) => c.id)).toEqual(["nc", "sw"]);
    expect(ng.children[0].depth).toBe(1);
    expect(ng.children[0].children.map((c) => c.id)).toEqual(["jos", "abj"]);
    expect(ng.children[0].children[0].depth).toBe(2);
  });

  it("orders siblings the way the church ordered them, then by name", () => {
    const tree = buildBandTree([
      band("b", null, "Benue", 2),
      band("a", null, "Abia", 1),
      band("c", null, "Cross River", 1),
    ]);
    expect(tree.map((t) => t.name)).toEqual(["Abia", "Cross River", "Benue"]);
  });

  it("keeps an orphan visible rather than losing it", () => {
    /*
     * A band whose parent has gone must not vanish. A row that disappears from
     * a filing system with no explanation is worse than one in the wrong
     * place, because the second can be seen and moved.
     */
    const tree = buildBandTree([band("x", "missing", "Stranded")]);
    expect(tree.map((t) => t.id)).toEqual(["x"]);
  });

  it("does not hang on a tree that already contains a loop", () => {
    const tree = buildBandTree([band("a", "b"), band("b", "a")]);
    expect(flattenBandTree(tree).length).toBeLessThanOrEqual(2);
  });

  it("flattens parents before their children", () => {
    const flat = flattenBandTree(buildBandTree(NETWORK)).map((b) => b.id);
    expect(flat.indexOf("ng")).toBeLessThan(flat.indexOf("nc"));
    expect(flat.indexOf("nc")).toBeLessThan(flat.indexOf("jos"));
  });
});

describe("what a filter on a band includes", () => {
  it("includes everything underneath it", () => {
    const ids = bandWithDescendants(NETWORK, "ng");
    expect(new Set(ids)).toEqual(new Set(["ng", "nc", "sw", "jos", "abj"]));
  });

  it("stops at its own branch of the tree", () => {
    expect(new Set(bandWithDescendants(NETWORK, "nc"))).toEqual(
      new Set(["nc", "jos", "abj"]),
    );
    expect(bandWithDescendants(NETWORK, "jos")).toEqual(["jos"]);
    expect(bandWithDescendants(NETWORK, "gh")).toEqual(["gh"]);
  });

  it("terminates on a loop instead of counting for ever", () => {
    const looped = [band("a", "b"), band("b", "a")];
    expect(new Set(bandWithDescendants(looped, "a"))).toEqual(new Set(["a", "b"]));
  });
});

describe("moving a band", () => {
  it("allows a sideways move to another parent", () => {
    expect(canReparent(NETWORK, "jos", "sw")).toEqual({ ok: true });
  });

  it("allows promoting a band to the top", () => {
    expect(canReparent(NETWORK, "jos", null)).toEqual({ ok: true });
  });

  it("refuses to put a band inside itself", () => {
    const r = canReparent(NETWORK, "nc", "nc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/inside itself/i);
  });

  it("refuses to put a band inside its own child", () => {
    /*
     * The loop that matters. "North Central" under "Jos District" would make
     * the tree circular, and both the page and every total that walks it
     * would never finish.
     */
    const r = canReparent(NETWORK, "nc", "jos");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loop/i);
  });

  it("refuses a grandchild too, not only a direct child", () => {
    expect(canReparent(NETWORK, "ng", "jos").ok).toBe(false);
  });
});

describe("saying where a church is", () => {
  it("reads downwards, widest band first", () => {
    expect(bandPath(NETWORK, "jos")).toBe("Nigeria · North Central · Jos District");
  });

  it("is empty for an unfiled branch", () => {
    expect(bandPath(NETWORK, null)).toBe("");
  });

  it("does not loop on a circular tree", () => {
    expect(bandPath([band("a", "b"), band("b", "a")], "a")).toContain("a");
  });
});
