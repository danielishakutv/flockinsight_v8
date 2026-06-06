"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const memberSchema = z.object({
  id: z.string().uuid().optional(),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  gender: z.preprocess(
    emptyToNull,
    z.enum(["male", "female"]).nullable(),
  ),
  phone: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().email("Invalid email").max(160).nullable(),
  ),
  status: z.enum(["active", "inactive", "visitor", "new_convert"]),
  dateOfBirth: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
      .nullable(),
  ),
  notes: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable()),
});

export type MemberInput = z.input<typeof memberSchema>;

export async function saveMember(input: MemberInput): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();

  try {
    if (d.id) {
      const [row] = await db
        .update(member)
        .set({
          firstName: d.firstName,
          lastName: d.lastName,
          gender: d.gender,
          phone: d.phone,
          email: d.email,
          status: d.status,
          dateOfBirth: d.dateOfBirth,
          notes: d.notes,
        })
        .where(and(eq(member.id, d.id), eq(member.churchId, church.id)))
        .returning({ id: member.id });
      if (!row) return { ok: false, error: "Member not found." };
      revalidatePath("/members");
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(member)
      .values({
        churchId: church.id,
        firstName: d.firstName,
        lastName: d.lastName,
        gender: d.gender,
        phone: d.phone,
        email: d.email,
        status: d.status,
        dateOfBirth: d.dateOfBirth,
        notes: d.notes,
        createdBy: user.id,
      })
      .returning({ id: member.id });

    revalidatePath("/members");
    revalidatePath("/dashboard");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("saveMember failed", e);
    return { ok: false, error: "Could not save member." };
  }
}

export async function deleteMember(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
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
