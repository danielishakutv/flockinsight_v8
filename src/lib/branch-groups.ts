import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { branchGroup, church } from "@/db/schema";
import {
  bandWithDescendants,
  canReparent,
  type BandNode,
} from "@/lib/branch-groups-shared";

/**
 * The bands a headquarters has drawn, and which branch sits in which.
 *
 * Every function here is scoped to ONE headquarters. A band belongs to the HQ
 * that made it, and a branch may only be filed into a band of the HQ it
 * actually reports to — so every write takes the hq id and checks it, rather
 * than trusting an id that arrived from a browser. Two networks on this
 * platform must never be able to see each other's filing system, let alone
 * move churches around in it.
 */

export type Band = BandNode & { branches: number };

/** Every band this headquarters has, with how many branches sit directly in each. */
export async function bandsOf(hqChurchId: string): Promise<Band[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: branchGroup.id,
        parentId: branchGroup.parentId,
        name: branchGroup.name,
        kind: branchGroup.kind,
        sort: branchGroup.sort,
      })
      .from(branchGroup)
      .where(eq(branchGroup.hqChurchId, hqChurchId))
      .orderBy(asc(branchGroup.sort), asc(branchGroup.name)),
    db
      .select({
        bandId: church.branchGroupId,
        c: sql<number>`count(*)::int`,
      })
      .from(church)
      .where(eq(church.parentChurchId, hqChurchId))
      .groupBy(church.branchGroupId),
  ]);

  const byBand = new Map<string, number>();
  for (const c of counts) if (c.bandId) byBand.set(c.bandId, Number(c.c));
  return rows.map((r) => ({ ...r, branches: byBand.get(r.id) ?? 0 }));
}

/** The plain nodes, for the pure helpers. */
async function nodesOf(hqChurchId: string): Promise<BandNode[]> {
  return db
    .select({
      id: branchGroup.id,
      parentId: branchGroup.parentId,
      name: branchGroup.name,
      kind: branchGroup.kind,
      sort: branchGroup.sort,
    })
    .from(branchGroup)
    .where(eq(branchGroup.hqChurchId, hqChurchId));
}

/**
 * Which branch ids a filter on one band covers.
 *
 * The descendants are the point: choosing a national band has to bring in the
 * zones inside it and the churches inside those. Filing happens at the bottom
 * and reports are read from the top, so without this a national filter would
 * return nothing at all.
 *
 * `"none"` is its own answer — the branches nobody has filed yet, which is the
 * list an administrator actually wants when they sit down to organise.
 */
export async function branchIdsInBand(
  hqChurchId: string,
  bandId: string,
): Promise<string[]> {
  if (bandId === "none") {
    const rows = await db
      .select({ id: church.id })
      .from(church)
      .where(
        and(eq(church.parentChurchId, hqChurchId), isNull(church.branchGroupId)),
      );
    return rows.map((r) => r.id);
  }

  const nodes = await nodesOf(hqChurchId);
  if (!nodes.some((n) => n.id === bandId)) return [];
  const ids = bandWithDescendants(nodes, bandId);
  const rows = await db
    .select({ id: church.id })
    .from(church)
    .where(
      and(
        eq(church.parentChurchId, hqChurchId),
        inArray(church.branchGroupId, ids),
      ),
    );
  return rows.map((r) => r.id);
}

/* ============================================================
 * Writes
 * ========================================================== */

export async function createBand(opts: {
  hqChurchId: string;
  name: string;
  kind: string;
  parentId: string | null;
  createdBy: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = opts.name.trim();
  if (!name) return { ok: false, error: "Give the group a name." };

  // A parent that is not this network's is not a parent.
  if (opts.parentId) {
    const [parent] = await db
      .select({ id: branchGroup.id })
      .from(branchGroup)
      .where(
        and(
          eq(branchGroup.id, opts.parentId),
          eq(branchGroup.hqChurchId, opts.hqChurchId),
        ),
      )
      .limit(1);
    if (!parent) return { ok: false, error: "We couldn't find that parent group." };
  }

  const [row] = await db
    .insert(branchGroup)
    .values({
      hqChurchId: opts.hqChurchId,
      name: name.slice(0, 120),
      kind: (opts.kind.trim() || "Group").slice(0, 40),
      parentId: opts.parentId,
      createdBy: opts.createdBy,
    })
    .returning({ id: branchGroup.id });
  return { ok: true, id: row.id };
}

export async function renameBand(opts: {
  hqChurchId: string;
  bandId: string;
  name: string;
  kind: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = opts.name.trim();
  if (!name) return { ok: false, error: "Give the group a name." };
  const res = await db
    .update(branchGroup)
    .set({
      name: name.slice(0, 120),
      kind: (opts.kind.trim() || "Group").slice(0, 40),
    })
    .where(
      and(
        eq(branchGroup.id, opts.bandId),
        eq(branchGroup.hqChurchId, opts.hqChurchId),
      ),
    )
    .returning({ id: branchGroup.id });
  if (res.length === 0) return { ok: false, error: "We couldn't find that group." };
  return { ok: true };
}

/**
 * Move a band under another one, or to the top.
 *
 * Refused if it would make a loop, with the reason — a loop here is a page
 * that never finishes rendering and a total that never finishes counting, and
 * the person rearranging their network deserves the sentence rather than a
 * silent no-op. The check is `canReparent`, tested without a database.
 */
export async function moveBand(opts: {
  hqChurchId: string;
  bandId: string;
  parentId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const nodes = await nodesOf(opts.hqChurchId);
  if (!nodes.some((n) => n.id === opts.bandId)) {
    return { ok: false, error: "We couldn't find that group." };
  }
  if (opts.parentId && !nodes.some((n) => n.id === opts.parentId)) {
    return { ok: false, error: "We couldn't find that parent group." };
  }

  const verdict = canReparent(nodes, opts.bandId, opts.parentId);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  await db
    .update(branchGroup)
    .set({ parentId: opts.parentId })
    .where(
      and(
        eq(branchGroup.id, opts.bandId),
        eq(branchGroup.hqChurchId, opts.hqChurchId),
      ),
    );
  return { ok: true };
}

/**
 * Delete a band. What happens to what was inside it is stated, not guessed.
 *
 * The bands underneath it go with it — that is what the database's cascade
 * says, and it is what a person means by deleting a region. The CHURCHES do
 * not: `church.branchGroupId` is `set null`, so every branch that was filed
 * there becomes unfiled and nothing about the church itself is touched. The
 * count of what will be affected is returned so the dialog can say it before
 * anybody agrees to it.
 */
export async function bandDeletionImpact(
  hqChurchId: string,
  bandId: string,
): Promise<{ bands: number; branches: number } | null> {
  const nodes = await nodesOf(hqChurchId);
  if (!nodes.some((n) => n.id === bandId)) return null;
  const ids = bandWithDescendants(nodes, bandId);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(church)
    .where(
      and(
        eq(church.parentChurchId, hqChurchId),
        inArray(church.branchGroupId, ids),
      ),
    );
  return { bands: ids.length, branches: Number(row?.c ?? 0) };
}

export async function deleteBand(opts: {
  hqChurchId: string;
  bandId: string;
}): Promise<{ ok: true; branchesUnfiled: number } | { ok: false; error: string }> {
  const impact = await bandDeletionImpact(opts.hqChurchId, opts.bandId);
  if (!impact) return { ok: false, error: "We couldn't find that group." };

  await db
    .delete(branchGroup)
    .where(
      and(
        eq(branchGroup.id, opts.bandId),
        eq(branchGroup.hqChurchId, opts.hqChurchId),
      ),
    );
  return { ok: true, branchesUnfiled: impact.branches };
}

/**
 * File branches into a band, or unfile them.
 *
 * Scoped twice over: the band must belong to this headquarters, and so must
 * every church being moved. Without the second check an id from a browser
 * could reach into another network and move somebody else's church.
 */
export async function fileBranches(opts: {
  hqChurchId: string;
  churchIds: string[];
  bandId: string | null;
}): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  if (opts.churchIds.length === 0) return { ok: false, error: "Nothing selected." };

  if (opts.bandId) {
    const [band] = await db
      .select({ id: branchGroup.id })
      .from(branchGroup)
      .where(
        and(
          eq(branchGroup.id, opts.bandId),
          eq(branchGroup.hqChurchId, opts.hqChurchId),
        ),
      )
      .limit(1);
    if (!band) return { ok: false, error: "We couldn't find that group." };
  }

  const moved = await db
    .update(church)
    .set({ branchGroupId: opts.bandId })
    .where(
      and(
        inArray(church.id, opts.churchIds.slice(0, 500)),
        eq(church.parentChurchId, opts.hqChurchId),
      ),
    )
    .returning({ id: church.id });

  return { ok: true, moved: moved.length };
}
