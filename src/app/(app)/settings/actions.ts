"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, givingCategory, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, canAny } from "@/lib/permissions";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

const NO_SETTINGS = {
  ok: false as const,
  error: "You don't have permission to manage church settings.",
};
const NO_GIVING = {
  ok: false as const,
  error: "You don't have permission to manage giving.",
};

/* ----------------------------- Church profile ----------------------------- */

const emptyToNullStr = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().min(1).max(8),
  country: z.string().trim().min(1).max(80),
  state: z.preprocess(emptyToNullStr, z.string().trim().max(80).nullable()),
});

export async function updateChurchProfile(input: {
  name: string;
  timezone: string;
  currency: string;
  country: string;
  state: string | null;
}): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_SETTINGS;
  await db
    .update(church)
    .set({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      country: parsed.data.country,
      state: parsed.data.state,
    })
    .where(eq(church.id, c.id));

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/giving");
  return { ok: true };
}

/* -------------------------------- Services -------------------------------- */

const serviceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM")
    .nullable(),
});

export async function createService(input: {
  name: string;
  dayOfWeek: number | null;
  startTime: string | null;
}): Promise<ActionResult> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_SETTINGS;
  const existing = await db
    .select({ id: service.id })
    .from(service)
    .where(eq(service.churchId, c.id));

  await db.insert(service).values({
    churchId: c.id,
    name: parsed.data.name,
    dayOfWeek: parsed.data.dayOfWeek,
    startTime: parsed.data.startTime,
    sortOrder: existing.length,
  });

  revalidatePath("/settings/services");
  revalidatePath("/attendance/record");
  return { ok: true };
}

export async function updateService(input: {
  id: string;
  name: string;
  dayOfWeek: number | null;
  startTime: string | null;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = serviceSchema
    .extend({ id: z.string().uuid(), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_SETTINGS;
  const [row] = await db
    .update(service)
    .set({
      name: parsed.data.name,
      dayOfWeek: parsed.data.dayOfWeek,
      startTime: parsed.data.startTime,
      isActive: parsed.data.isActive,
    })
    .where(and(eq(service.id, parsed.data.id), eq(service.churchId, c.id)))
    .returning({ id: service.id });
  if (!row) return { ok: false, error: "Service not found." };

  revalidatePath("/settings/services");
  revalidatePath("/attendance/record");
  return { ok: true };
}

export async function deleteService(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) return NO_SETTINGS;
  const [row] = await db
    .delete(service)
    .where(and(eq(service.id, id), eq(service.churchId, c.id)))
    .returning({ id: service.id });
  if (!row) return { ok: false, error: "Service not found." };

  revalidatePath("/settings/services");
  revalidatePath("/attendance/record");
  return { ok: true };
}

/* ---------------------------- Giving categories --------------------------- */

const givingCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(500).nullable(),
  ),
});

export async function createGivingCategory(input: {
  name: string;
  description: string | null;
}): Promise<ActionResult> {
  const parsed = givingCategorySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const existing = await db
    .select({ id: givingCategory.id })
    .from(givingCategory)
    .where(eq(givingCategory.churchId, c.id));

  await db.insert(givingCategory).values({
    churchId: c.id,
    name: parsed.data.name,
    description: parsed.data.description,
    sortOrder: existing.length,
  });

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

/** Create several giving categories at once (used by the giving setup flow). */
export async function createGivingCategories(
  names: string[],
): Promise<ActionResult> {
  const clean = [
    ...new Set(
      (names ?? [])
        .map((n) => (typeof n === "string" ? n.trim() : ""))
        .filter(Boolean)
        .map((n) => n.slice(0, 120)),
    ),
  ].slice(0, 20);
  if (clean.length === 0)
    return { ok: false, error: "Add at least one category." };

  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const existing = await db
    .select({ id: givingCategory.id })
    .from(givingCategory)
    .where(eq(givingCategory.churchId, c.id));

  await db.insert(givingCategory).values(
    clean.map((name, i) => ({
      churchId: c.id,
      name,
      sortOrder: existing.length + i,
    })),
  );

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

export async function updateGivingCategory(input: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = givingCategorySchema
    .extend({ id: z.string().uuid(), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const [row] = await db
    .update(givingCategory)
    .set({
      name: parsed.data.name,
      description: parsed.data.description,
      isActive: parsed.data.isActive,
    })
    .where(
      and(
        eq(givingCategory.id, parsed.data.id),
        eq(givingCategory.churchId, c.id),
      ),
    )
    .returning({ id: givingCategory.id });
  if (!row) return { ok: false, error: "Category not found." };

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

export async function deleteGivingCategory(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const [row] = await db
    .delete(givingCategory)
    .where(and(eq(givingCategory.id, id), eq(givingCategory.churchId, c.id)))
    .returning({ id: givingCategory.id });
  if (!row) return { ok: false, error: "Category not found." };

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}
