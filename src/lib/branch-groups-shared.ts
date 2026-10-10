/**
 * The shape of a church network, with no database in it.
 *
 * A mega church does not think in a flat list of branches. It thinks
 * "Nigeria → North Central → Jos District → the three churches in Jos", and
 * every network draws those lines differently: zones, regions, provinces,
 * areas, circuits. So the levels are not fixed anywhere. A band carries the
 * church's own word for what it is and points at the band above it, and the
 * depth is whatever they build.
 *
 * Everything here is pure, because the two things that matter about a tree —
 * that it has no cycles, and which branches a filter includes — are exactly
 * the things worth testing without a database. See branch-groups-shared.test.ts.
 */

export type BandNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  sort: number;
};

/**
 * A band with its children attached, and the depth it sits at.
 *
 * Generic over the node, so whatever the caller knows about a band — how many
 * branches are filed in it, for instance — survives the trip through the tree.
 * A helper that quietly narrowed its input to the fields it happened to need
 * would make every caller cast it back.
 */
export type BandTree<T extends BandNode = BandNode> = T & {
  depth: number;
  children: BandTree<T>[];
};

/**
 * The words a network is most likely to want, offered rather than imposed.
 *
 * `kind` is free text in the database on purpose — a church may run circuits,
 * parishes, provinces or something nobody else uses, and their reports should
 * print their word. These are a starting list in a dropdown that also takes
 * typing.
 */
export const BAND_KINDS = [
  "National",
  "Regional",
  "Zonal",
  "Provincial",
  "District",
  "Area",
  "Circuit",
  "Group",
] as const;

/** Sorted the way a church reads its own list: by their order, then by name. */
function bySortThenName(a: BandNode, b: BandNode): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  return a.name.localeCompare(b.name);
}

/**
 * Turn a flat list into the tree, dropping nothing.
 *
 * A band whose parent is missing — deleted underneath us, or belonging to
 * another church — is treated as a top level rather than vanishing. A row that
 * disappears from a filing system with no explanation is worse than one that
 * turns up in the wrong place, because the second can be seen and moved.
 */
export function buildBandTree<T extends BandNode>(bands: T[]): BandTree<T>[] {
  const byId = new Map<string, BandTree<T>>();
  for (const b of bands) byId.set(b.id, { ...b, depth: 0, children: [] });

  const roots: BandTree<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const settleDepth = (nodes: BandTree<T>[], depth: number) => {
    nodes.sort(bySortThenName);
    for (const n of nodes) {
      n.depth = depth;
      settleDepth(n.children, depth + 1);
    }
  };
  settleDepth(roots, 0);
  return roots;
}

/** The tree flattened back out, parents before children, for a list or a select. */
export function flattenBandTree<T extends BandNode>(
  tree: BandTree<T>[],
): BandTree<T>[] {
  const out: BandTree<T>[] = [];
  const walk = (nodes: BandTree<T>[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * A band and everything underneath it.
 *
 * This is what makes a filter mean what a person expects: choosing "North
 * Central" has to include the districts inside it and the churches inside
 * those, not just the branches filed directly against that one row. Without
 * it, a national report would show nothing at all, because churches are filed
 * at the bottom and reports are read from the top.
 *
 * Guarded against a cycle it did not create, so a tree that somehow has one
 * cannot hang the page that is trying to show it.
 */
export function bandWithDescendants(bands: BandNode[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const b of bands) {
    if (!b.parentId) continue;
    const list = children.get(b.parentId);
    if (list) list.push(b.id);
    else children.set(b.parentId, [b.id]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * May this band be moved under that one?
 *
 * The two answers that matter are "no, that is itself" and "no, that is one of
 * its own descendants" — either would make a loop, and a loop in a filing
 * system is a page that never finishes rendering and a report that never
 * finishes counting. Returns the reason rather than a boolean, because the
 * person doing it deserves the sentence.
 */
export function canReparent(
  bands: BandNode[],
  bandId: string,
  nextParentId: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (!nextParentId) return { ok: true };
  if (nextParentId === bandId) {
    return { ok: false, reason: "A group cannot sit inside itself." };
  }
  const inside = new Set(bandWithDescendants(bands, bandId));
  if (inside.has(nextParentId)) {
    return {
      ok: false,
      reason:
        "That group is already inside this one, so moving it there would make a loop.",
    };
  }
  return { ok: true };
}

/**
 * "North Central · Jos District", for a row and for a CSV column.
 *
 * Read downwards, because that is how somebody says where a church is: the
 * widest band first and the narrowest last.
 */
export function bandPath(bands: BandNode[], bandId: string | null): string {
  if (!bandId) return "";
  const byId = new Map(bands.map((b) => [b.id, b]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = bandId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const band = byId.get(cursor);
    if (!band) break;
    parts.unshift(band.name);
    cursor = band.parentId;
  }
  return parts.join(" · ");
}
