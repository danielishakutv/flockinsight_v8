import "server-only";
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, denomination } from "@/db/schema";

export type DenominationRow = {
  id: string;
  name: string;
  abbreviation: string | null;
  notes: string | null;
  archived: boolean;
  churches: number;
  members: number;
};

/**
 * Every denomination with how many churches sit under it. Archived ones come
 * last — they only exist so old names still read correctly after a merge.
 */
export async function listDenominations(): Promise<DenominationRow[]> {
  const rows = await db
    .select({
      id: denomination.id,
      name: denomination.name,
      abbreviation: denomination.abbreviation,
      notes: denomination.notes,
      archived: denomination.archived,
      churches: count(church.id),
    })
    .from(denomination)
    .leftJoin(church, eq(church.denominationId, denomination.id))
    .groupBy(denomination.id)
    .orderBy(asc(denomination.archived), asc(denomination.name));

  return rows.map((r) => ({ ...r, churches: Number(r.churches), members: 0 }));
}

/** Names only, for pickers. Archived ones are not offered. */
export async function denominationOptions() {
  return db
    .select({
      id: denomination.id,
      name: denomination.name,
      abbreviation: denomination.abbreviation,
    })
    .from(denomination)
    .where(eq(denomination.archived, false))
    .orderBy(asc(denomination.name));
}

export async function getDenomination(id: string) {
  const [row] = await db
    .select()
    .from(denomination)
    .where(eq(denomination.id, id))
    .limit(1);
  return row ?? null;
}

/** Churches in a denomination, plus the ones still unassigned. */
export async function denominationChurches(id: string) {
  const [members, unassigned] = await Promise.all([
    db
      .select({
        id: church.id,
        name: church.name,
        plan: church.plan,
        country: church.country,
        state: church.state,
      })
      .from(church)
      .where(eq(church.denominationId, id))
      .orderBy(asc(church.name)),
    db
      .select({
        id: church.id,
        name: church.name,
        denomination: church.denomination,
      })
      .from(church)
      .where(isNull(church.denominationId))
      .orderBy(asc(church.name)),
  ]);
  return { members, unassigned };
}

/** How many churches have no denomination yet — the nudge on the index page. */
export async function unassignedChurchCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(church)
    .where(isNull(church.denominationId));
  return Number(row?.c ?? 0);
}

/**
 * Churches whose typed denomination text looks like this one, but which aren't
 * assigned yet — so a new denomination can hoover up the obvious matches
 * instead of making someone tick 40 boxes.
 */
export async function suggestedChurches(name: string, abbreviation?: string | null) {
  const needles = [name, abbreviation].filter(
    (v): v is string => !!v && v.trim().length >= 3,
  );
  if (needles.length === 0) return [];
  return db
    .select({ id: church.id, name: church.name, denomination: church.denomination })
    .from(church)
    .where(
      and(
        isNull(church.denominationId),
        sql`${church.denomination} is not null`,
        sql`(${sql.join(
          needles.map((n) => sql`${church.denomination} ilike ${`%${n}%`}`),
          sql` or `,
        )})`,
      ),
    )
    .orderBy(asc(church.name));
}

/**
 * Point churches at a denomination and copy its name into the church's own
 * text field, so the public directory and church pages keep showing something
 * sensible without a second edit.
 */
export async function assignChurches(
  denominationId: string,
  churchIds: string[],
): Promise<number> {
  if (churchIds.length === 0) return 0;
  const target = await getDenomination(denominationId);
  if (!target) return 0;
  const rows = await db
    .update(church)
    .set({ denominationId, denomination: target.name })
    .where(inArray(church.id, churchIds))
    .returning({ id: church.id });
  return rows.length;
}

/** Take churches back out of a denomination, leaving their own text alone. */
export async function unassignChurches(churchIds: string[]): Promise<number> {
  if (churchIds.length === 0) return 0;
  const rows = await db
    .update(church)
    .set({ denominationId: null })
    .where(inArray(church.id, churchIds))
    .returning({ id: church.id });
  return rows.length;
}

/** Move every church from one denomination to another and retire the empty one. */
export async function mergeDenominations(
  fromId: string,
  intoId: string,
): Promise<number> {
  if (fromId === intoId) return 0;
  const into = await getDenomination(intoId);
  if (!into) return 0;
  const moved = await db
    .update(church)
    .set({ denominationId: intoId, denomination: into.name })
    .where(eq(church.denominationId, fromId))
    .returning({ id: church.id });
  await db
    .update(denomination)
    .set({ archived: true })
    .where(and(eq(denomination.id, fromId), ne(denomination.id, intoId)));
  return moved.length;
}
