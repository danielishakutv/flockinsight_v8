import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { household, member } from "@/db/schema";

/* ============================================================
 * Households — an optional family grouping. Shared queries for the household
 * index/detail pages and the member form's household picker.
 * ========================================================== */

/** Create a household and return its id. */
export async function createHousehold(
  churchId: string,
  name: string,
  userId?: string,
): Promise<string> {
  const [row] = await db
    .insert(household)
    .values({ churchId, name: name.trim().slice(0, 120) || "Household", createdBy: userId })
    .returning({ id: household.id });
  return row.id;
}

/** True if a household id belongs to this church. */
export async function householdInChurch(
  churchId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: household.id })
    .from(household)
    .where(and(eq(household.id, id), eq(household.churchId, churchId)))
    .limit(1);
  return !!row;
}

export type HouseholdListItem = {
  id: string;
  name: string;
  members: number;
  adults: number;
  children: number;
  headName: string | null;
};

/** All households in a church with member counts, newest activity first. */
export async function listHouseholds(
  churchId: string,
): Promise<HouseholdListItem[]> {
  const rows = await db
    .select({
      id: household.id,
      name: household.name,
      headMemberId: household.headMemberId,
      updatedAt: household.updatedAt,
      members: sql<number>`count(${member.id})`,
      adults: sql<number>`count(${member.id}) filter (where ${member.isMinor} = false)`,
      children: sql<number>`count(${member.id}) filter (where ${member.isMinor} = true)`,
    })
    .from(household)
    .leftJoin(member, eq(member.householdId, household.id))
    .where(eq(household.churchId, churchId))
    .groupBy(household.id)
    .orderBy(desc(household.updatedAt));

  // Resolve head names in one lookup (heads are members of the church).
  const headIds = [
    ...new Set(rows.map((r) => r.headMemberId).filter((v): v is string => !!v)),
  ];
  const headName = new Map<string, string>();
  if (headIds.length > 0) {
    const heads = await db
      .select({ id: member.id, firstName: member.firstName, lastName: member.lastName })
      .from(member)
      .where(eq(member.churchId, churchId));
    for (const h of heads)
      if (headIds.includes(h.id))
        headName.set(h.id, [h.firstName, h.lastName].filter(Boolean).join(" "));
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    members: Number(r.members),
    adults: Number(r.adults),
    children: Number(r.children),
    headName: r.headMemberId ? headName.get(r.headMemberId) ?? null : null,
  }));
}

/** Lightweight list for the member form's household picker. */
export async function householdOptions(
  churchId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: household.id, name: household.name })
    .from(household)
    .where(eq(household.churchId, churchId))
    .orderBy(asc(household.name));
}

export type HouseholdMember = {
  id: string;
  name: string;
  isMinor: boolean;
  relationship: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  isHead: boolean;
};

export type HouseholdDetail = {
  id: string;
  name: string;
  note: string | null;
  headMemberId: string | null;
  members: HouseholdMember[];
};

/** A single household with its members, or null if not found in this church. */
export async function getHousehold(
  churchId: string,
  id: string,
): Promise<HouseholdDetail | null> {
  const [h] = await db
    .select({
      id: household.id,
      name: household.name,
      note: household.note,
      headMemberId: household.headMemberId,
    })
    .from(household)
    .where(and(eq(household.id, id), eq(household.churchId, churchId)))
    .limit(1);
  if (!h) return null;

  const members = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      isMinor: member.isMinor,
      relationship: member.relationship,
      status: member.status,
      phone: member.phone,
      email: member.email,
    })
    .from(member)
    .where(and(eq(member.householdId, id), eq(member.churchId, churchId)))
    .orderBy(asc(member.isMinor), asc(member.firstName), asc(member.lastName));

  return {
    ...h,
    members: members.map((m) => ({
      id: m.id,
      name: [m.firstName, m.lastName].filter(Boolean).join(" "),
      isMinor: m.isMinor,
      relationship: m.relationship,
      status: m.status,
      phone: m.phone,
      email: m.email,
      isHead: m.id === h.headMemberId,
    })),
  };
}
