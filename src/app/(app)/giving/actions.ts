"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const METHODS = [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
] as const;

const givingSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  amount: z.preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    z
      .number({ message: "Enter an amount" })
      .positive("Amount must be greater than 0")
      .max(1_000_000_000_000),
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  giverName: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  method: z.preprocess(emptyToNull, z.enum(METHODS).nullable()),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
});

export type GivingInput = z.input<typeof givingSchema>;

export async function recordGiving(input: GivingInput): Promise<ActionResult> {
  const parsed = givingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();

  // Category, if given, must belong to this church.
  if (d.categoryId) {
    const [cat] = await db
      .select({ id: givingCategory.id })
      .from(givingCategory)
      .where(
        and(
          eq(givingCategory.id, d.categoryId),
          eq(givingCategory.churchId, church.id),
        ),
      )
      .limit(1);
    if (!cat) return { ok: false, error: "That category doesn't exist." };
  }

  // Member, if given, must belong to this church.
  if (d.memberId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, d.memberId), eq(member.churchId, church.id)))
      .limit(1);
    if (!m) return { ok: false, error: "That giver isn't in your congregation." };
  }

  const fields = {
    categoryId: d.categoryId,
    amount: d.amount,
    date: d.date,
    memberId: d.memberId,
    giverName: d.giverName,
    method: d.method,
    note: d.note,
  };

  try {
    if (d.id) {
      const [row] = await db
        .update(giving)
        .set(fields)
        .where(and(eq(giving.id, d.id), eq(giving.churchId, church.id)))
        .returning({ id: giving.id });
      if (!row) return { ok: false, error: "Giving record not found." };
      revalidatePath("/giving");
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(giving)
      .values({ churchId: church.id, ...fields, recordedBy: user.id })
      .returning({ id: giving.id });

    revalidatePath("/giving");
    revalidatePath("/dashboard");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("recordGiving failed", e);
    return { ok: false, error: "Could not save the giving record." };
  }
}

export async function deleteGiving(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
  try {
    const [row] = await db
      .delete(giving)
      .where(and(eq(giving.id, id), eq(giving.churchId, church.id)))
      .returning({ id: giving.id });
    if (!row) return { ok: false, error: "Giving record not found." };
    revalidatePath("/giving");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteGiving failed", e);
    return { ok: false, error: "Could not delete the giving record." };
  }
}
