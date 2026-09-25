"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { household, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { householdInChurch } from "@/lib/households";
import { audit } from "@/lib/audit";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

async function guard() {
  const { church, user } = await requireChurch();
  if (!(await can("members.manage")))
    return { ok: false as const, error: "You don't have permission to do that." };
  return { ok: true as const, church, user };
}

const uuid = z.string().uuid();

/** Create a household (optionally seeding it with some members). */
export async function createHouseholdAction(
  name: string,
  memberIds: string[] = [],
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const clean = (name ?? "").trim().slice(0, 120);
  if (!clean) return { ok: false, error: "Give the household a name." };

  const [row] = await db
    .insert(household)
    .values({ churchId: g.church.id, name: clean, createdBy: g.user.id })
    .returning({ id: household.id });

  const ids = [...new Set(memberIds.filter((v) => uuid.safeParse(v).success))];
  if (ids.length > 0)
    await db
      .update(member)
      .set({ householdId: row.id })
      .where(and(eq(member.churchId, g.church.id), inArray(member.id, ids)));

  await audit({
    churchId: g.church.id,
    action: "members.household.create",
    summary: `Created the household "${clean}"${ids.length ? ` with ${ids.length} member${ids.length === 1 ? "" : "s"}` : ""}`,
    targetType: "household",
    targetId: row.id,
    targetLabel: clean,
    meta: { memberIds: ids },
  });

  revalidatePath("/members/households");
  revalidatePath(`/members/households/${row.id}`);
  return { ok: true, id: row.id };
}

export async function renameHousehold(
  id: string,
  name: string,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };
  const clean = (name ?? "").trim().slice(0, 120);
  if (!clean) return { ok: false, error: "Give the household a name." };

  const [row] = await db
    .update(household)
    .set({ name: clean })
    .where(and(eq(household.id, id), eq(household.churchId, g.church.id)))
    .returning({ id: household.id });
  if (!row) return { ok: false, error: "Household not found." };

  await audit({
    churchId: g.church.id,
    action: "members.household.update",
    summary: `Renamed a household to "${clean}"`,
    targetType: "household",
    targetId: id,
    targetLabel: clean,
  });

  revalidatePath("/members/households");
  revalidatePath(`/members/households/${id}`);
  return { ok: true, id };
}

export async function setHouseholdNote(
  id: string,
  note: string,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };
  const [row] = await db
    .update(household)
    .set({ note: (note ?? "").trim().slice(0, 2000) || null })
    .where(and(eq(household.id, id), eq(household.churchId, g.church.id)))
    .returning({ id: household.id });
  if (!row) return { ok: false, error: "Household not found." };

  await audit({
    churchId: g.church.id,
    action: "members.household.update",
    summary: "Updated a household's note",
    targetType: "household",
    targetId: id,
  });

  revalidatePath(`/members/households/${id}`);
  return { ok: true, id };
}

/** Set (or clear) the head — the head must be a member of this household. */
export async function setHouseholdHead(
  id: string,
  memberId: string | null,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };

  if (memberId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.id, memberId),
          eq(member.churchId, g.church.id),
          eq(member.householdId, id),
        ),
      )
      .limit(1);
    if (!m)
      return { ok: false, error: "The head must be a member of this household." };
  }

  const [row] = await db
    .update(household)
    .set({ headMemberId: memberId })
    .where(and(eq(household.id, id), eq(household.churchId, g.church.id)))
    .returning({ id: household.id });
  if (!row) return { ok: false, error: "Household not found." };

  await audit({
    churchId: g.church.id,
    action: "members.household.update",
    summary: memberId
      ? "Set the head of a household"
      : "Cleared the head of a household",
    targetType: "household",
    targetId: id,
    meta: { headMemberId: memberId },
  });

  revalidatePath(`/members/households/${id}`);
  return { ok: true, id };
}

/** Add existing members to a household. */
export async function addMembersToHousehold(
  id: string,
  memberIds: string[],
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(await householdInChurch(g.church.id, id)))
    return { ok: false, error: "Household not found." };
  const ids = [...new Set((memberIds ?? []).filter((v) => uuid.safeParse(v).success))];
  if (ids.length === 0) return { ok: false, error: "No members selected." };

  await db
    .update(member)
    .set({ householdId: id })
    .where(and(eq(member.churchId, g.church.id), inArray(member.id, ids)));

  await audit({
    churchId: g.church.id,
    action: "members.household.update",
    summary: `Added ${ids.length} ${ids.length === 1 ? "person" : "people"} to a household`,
    targetType: "household",
    targetId: id,
    meta: { memberIds: ids },
  });

  revalidatePath("/members/households");
  revalidatePath(`/members/households/${id}`);
  return { ok: true, id };
}

/** Remove one member from their household (also clears head if it was them). */
export async function removeMemberFromHousehold(
  householdId: string,
  memberId: string,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(memberId).success || !uuid.safeParse(householdId).success)
    return { ok: false, error: "Invalid id." };

  await db
    .update(member)
    .set({ householdId: null })
    .where(and(eq(member.id, memberId), eq(member.churchId, g.church.id)));
  // If they were the head, clear it.
  await db
    .update(household)
    .set({ headMemberId: null })
    .where(
      and(
        eq(household.id, householdId),
        eq(household.churchId, g.church.id),
        eq(household.headMemberId, memberId),
      ),
    );
  await audit({
    churchId: g.church.id,
    action: "members.household.remove",
    summary: "Removed someone from a household",
    targetType: "household",
    targetId: householdId,
    meta: { memberId },
  });

  revalidatePath("/members/households");
  revalidatePath(`/members/households/${householdId}`);
  return { ok: true, id: householdId };
}

/** Delete a household. Members are kept (their household link is set null). */
export async function deleteHousehold(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };
  const [row] = await db
    .delete(household)
    .where(and(eq(household.id, id), eq(household.churchId, g.church.id)))
    .returning({ id: household.id, name: household.name });
  if (!row) return { ok: false, error: "Household not found." };

  await audit({
    churchId: g.church.id,
    action: "members.household.delete",
    summary: `Deleted the household "${row.name}" — its members were kept`,
    targetType: "household",
    targetId: id,
    targetLabel: row.name,
    severity: "warning",
  });

  revalidatePath("/members/households");
  return { ok: true, id };
}
