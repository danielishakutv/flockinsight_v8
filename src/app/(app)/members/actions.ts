"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { memberLimitStatus } from "@/lib/plan-limits";
import { planName } from "@/lib/plans";
import { recordAction } from "@/lib/analytics";
import { createHousehold, householdInChurch } from "@/lib/households";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const optDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .nullable(),
);

const memberSchema = z.object({
  id: z.string().uuid().optional(),
  photoUrl: optText(500),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  middleName: optText(80),
  lastName: optText(80),
  gender: z.preprocess(emptyToNull, z.enum(["male", "female"]).nullable()),
  phone: optText(40),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().email("Invalid email").max(160).nullable(),
  ),
  status: z.enum(["active", "inactive", "visitor", "new_convert"]),
  isMinor: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
  guardianId: z.preprocess(emptyToNull, z.string().uuid().nullable()).default(null),
  relationship: optText(40),
  // Household: link to an existing one, or provide a name to create a new one.
  householdId: z.preprocess(emptyToNull, z.string().uuid().nullable()).default(null),
  householdName: optText(120),
  dateOfBirth: optDate,
  joinedAt: optDate,
  weddingDate: optDate,
  baptized: z.preprocess((v) => v === true || v === "true", z.boolean()),
  baptismDate: optDate,
  anniversaries: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
      }),
    )
    .max(12)
    .optional()
    .default([]),
  house: optText(120),
  street: optText(160),
  city: optText(120),
  lga: optText(120),
  state: optText(120),
  country: optText(120),
  notes: optText(1000),
});

export type MemberInput = z.input<typeof memberSchema>;

export async function saveMember(input: MemberInput): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();
  if (!(await can("members.manage")))
    return { ok: false, error: "You don't have permission to manage members." };

  // Guardian link (only meaningful for a child). Validate it belongs to this
  // church and isn't the member themselves, so a bad id can never link across
  // churches or make someone their own guardian.
  let guardianId: string | null = d.isMinor ? d.guardianId : null;
  const relationship = d.isMinor ? d.relationship : null;
  if (guardianId) {
    if (d.id && guardianId === d.id)
      return { ok: false, error: "A member can't be their own guardian." };
    const [g] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, guardianId), eq(member.churchId, church.id)))
      .limit(1);
    if (!g)
      return { ok: false, error: "That guardian isn't a member of your church." };
    guardianId = g.id;
  }

  // Household: create a new one if a name was typed, else use the selected one
  // (validated to belong to this church). Blank = no household (optional).
  let householdId: string | null = null;
  if (d.householdName) {
    householdId = await createHousehold(church.id, d.householdName, user.id);
  } else if (d.householdId) {
    if (!(await householdInChurch(church.id, d.householdId)))
      return { ok: false, error: "That household isn't part of your church." };
    householdId = d.householdId;
  }

  // Fields shared by insert and update.
  const fields = {
    photoUrl: d.photoUrl,
    firstName: d.firstName,
    middleName: d.middleName,
    lastName: d.lastName,
    gender: d.gender,
    phone: d.phone,
    email: d.email,
    status: d.status,
    isMinor: d.isMinor,
    guardianId,
    relationship,
    householdId,
    dateOfBirth: d.dateOfBirth,
    joinedAt: d.joinedAt,
    weddingDate: d.weddingDate,
    baptized: d.baptized,
    baptismDate: d.baptized ? d.baptismDate : null,
    anniversaries: d.anniversaries,
    house: d.house,
    street: d.street,
    city: d.city,
    lga: d.lga,
    state: d.state,
    country: d.country,
    notes: d.notes,
  };

  try {
    if (d.id) {
      const [row] = await db
        .update(member)
        .set(fields)
        .where(and(eq(member.id, d.id), eq(member.churchId, church.id)))
        .returning({ id: member.id });
      if (!row) return { ok: false, error: "Member not found." };
      revalidatePath("/members");
      revalidatePath(`/members/${row.id}`);
      // The guardian's profile lists their children — keep it fresh.
      if (guardianId) revalidatePath(`/members/${guardianId}`);
      if (householdId) {
        revalidatePath("/members/households");
        revalidatePath(`/members/households/${householdId}`);
      }
      return { ok: true, id: row.id };
    }

    // Plan member limit (pauses adds until upgraded/renewed to a bigger plan).
    const limit = await memberLimitStatus(church.id);
    if (limit.atLimit) {
      return {
        ok: false,
        error: `You've reached the ${planName(limit.plan)} plan limit of ${limit.limit} members. Upgrade your plan to add more.`,
      };
    }

    const [row] = await db
      .insert(member)
      .values({ churchId: church.id, ...fields, createdBy: user.id })
      .returning({ id: member.id });

    try {
      await recordAction({
        churchId: church.id,
        userId: user.id,
        name: "member.added",
        plan: church.plan,
      });
    } catch {
      /* analytics best-effort */
    }

    revalidatePath("/members");
    revalidatePath("/dashboard");
    if (guardianId) revalidatePath(`/members/${guardianId}`);
    if (householdId) {
      revalidatePath("/members/households");
      revalidatePath(`/members/households/${householdId}`);
    }
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("saveMember failed", e);
    return { ok: false, error: "Could not save member." };
  }
}

export type BulkResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

/** Delete many members at once (church-scoped). */
export async function deleteMembers(ids: string[]): Promise<BulkResult> {
  const clean = [...new Set((ids ?? []).filter((v) => typeof v === "string"))];
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.some((id) => !z.string().uuid().safeParse(id).success))
    return { ok: false, error: "Invalid selection." };
  if (clean.length > 1000)
    return { ok: false, error: "Please delete at most 1000 at a time." };

  const { church } = await requireChurch();
  if (!(await can("members.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  try {
    const rows = await db
      .delete(member)
      .where(and(inArray(member.id, clean), eq(member.churchId, church.id)))
      .returning({ id: member.id });
    revalidatePath("/members");
    revalidatePath("/dashboard");
    return { ok: true, deleted: rows.length };
  } catch (e) {
    console.error("deleteMembers failed", e);
    return { ok: false, error: "Could not delete the selected members." };
  }
}

export async function deleteMember(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
  if (!(await can("members.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  try {
    const [row] = await db
      .delete(member)
      .where(and(eq(member.id, id), eq(member.churchId, church.id)))
      .returning({ id: member.id });
    if (!row) return { ok: false, error: "Member not found." };
    revalidatePath("/members");
    revalidatePath("/dashboard");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteMember failed", e);
    return { ok: false, error: "Could not delete member." };
  }
}
