"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  givingCategory,
  givingReceiptSetting,
  pledgeReminderSetting,
  service,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { fundAccountFor } from "@/lib/finance-giving-sync";
import { createFundForCategory } from "@/app/(app)/finance/actions";
import { can, canAny } from "@/lib/permissions";
import { audit, diffFields, summariseChanges } from "@/lib/audit";

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

  const next = {
    name: parsed.data.name,
    timezone: parsed.data.timezone,
    currency: parsed.data.currency,
    country: parsed.data.country,
    state: parsed.data.state,
  };
  await db.update(church).set(next).where(eq(church.id, c.id));

  const changed = diffFields(
    c as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    Object.keys(next),
  );
  if (Object.keys(changed).length > 0) {
    await audit({
      churchId: c.id,
      action: "settings.profile.update",
      // The currency is the one that matters here: changing it re-labels every
      // figure in the church's history without converting any of them.
      summary: `Changed the church ${summariseChanges(changed)}`,
      targetType: "church",
      targetId: c.id,
      targetLabel: parsed.data.name,
      meta: { changed },
      severity: changed.currency ? "critical" : "notice",
    });
  }

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

  const [created] = await db
    .insert(service)
    .values({
      churchId: c.id,
      name: parsed.data.name,
      dayOfWeek: parsed.data.dayOfWeek,
      startTime: parsed.data.startTime,
      sortOrder: existing.length,
    })
    .returning({ id: service.id });

  await audit({
    churchId: c.id,
    action: "settings.service.create",
    summary: `Added the service "${parsed.data.name}"`,
    targetType: "service",
    targetId: created?.id,
    targetLabel: parsed.data.name,
    meta: { dayOfWeek: parsed.data.dayOfWeek, startTime: parsed.data.startTime },
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

  await audit({
    churchId: c.id,
    action: "settings.service.update",
    summary: `Updated the service "${parsed.data.name}"`,
    targetType: "service",
    targetId: row.id,
    targetLabel: parsed.data.name,
    meta: {
      dayOfWeek: parsed.data.dayOfWeek,
      startTime: parsed.data.startTime,
      isActive: parsed.data.isActive,
    },
  });

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
    .returning({ id: service.id, name: service.name });
  if (!row) return { ok: false, error: "Service not found." };

  await audit({
    churchId: c.id,
    action: "settings.service.delete",
    summary: `Deleted the service "${row.name}"`,
    targetType: "service",
    targetId: row.id,
    targetLabel: row.name,
    severity: "warning",
  });

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
  autoFinanceAccount?: boolean;
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

  const autoFinanceAccount = input.autoFinanceAccount ?? true;

  const [created] = await db
    .insert(givingCategory)
    .values({
      churchId: c.id,
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: existing.length,
      autoFinanceAccount,
    })
    .returning({ id: givingCategory.id });

  // A brand new category has no giving yet, so there is nothing to backfill —
  // the fund simply starts empty and fills as gifts come in.
  if (autoFinanceAccount && created) {
    await createFundForCategory(created.id);
  }

  await audit({
    churchId: c.id,
    action: "giving.category.create",
    summary: `Added the giving category "${parsed.data.name}"`,
    targetType: "giving-category",
    targetId: created?.id,
    targetLabel: parsed.data.name,
    meta: { autoFinanceAccount },
  });

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  revalidatePath("/finance");
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

  await audit({
    churchId: c.id,
    action: "giving.category.create",
    summary: `Added ${clean.length} giving categor${clean.length === 1 ? "y" : "ies"}`,
    targetType: "giving-category",
    meta: { names: clean },
  });

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

  await audit({
    churchId: c.id,
    action: "giving.category.update",
    summary: `Updated the giving category "${parsed.data.name}"`,
    targetType: "giving-category",
    targetId: row.id,
    targetLabel: parsed.data.name,
    meta: { isActive: parsed.data.isActive },
  });

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

export async function deleteGivingCategory(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;

  // A fund account hanging off this category holds real financial records.
  // Deleting the category would set the link null and silently turn the fund
  // into an ordinary account — a change to the books nobody asked for. Refuse,
  // and let them unlink deliberately from Finance first.
  const fund = await fundAccountFor(c.id, id);
  if (fund) {
    return {
      ok: false,
      error: `"${fund.name}" in Finance is this category's fund account. Unlink it there first — that keeps every record it holds.`,
    };
  }

  const [row] = await db
    .delete(givingCategory)
    .where(and(eq(givingCategory.id, id), eq(givingCategory.churchId, c.id)))
    .returning({ id: givingCategory.id, name: givingCategory.name });
  if (!row) return { ok: false, error: "Category not found." };

  await audit({
    churchId: c.id,
    action: "giving.category.delete",
    summary: `Deleted the giving category "${row.name}"`,
    targetType: "giving-category",
    targetId: row.id,
    targetLabel: row.name,
    severity: "warning",
  });

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

/* --------------------------- Giving receipts ----------------------------- */

const receiptSchema = z.object({
  enabled: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
  emailSubject: z.string().trim().min(1, "Add an email subject").max(160),
  emailBody: z.string().trim().min(1, "Add an email message").max(2000),
  smsBody: z.string().trim().min(1, "Add an SMS message").max(480),
});

export type GivingReceiptInput = z.input<typeof receiptSchema>;

export async function saveGivingReceiptSettings(
  input: GivingReceiptInput,
): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await db
    .insert(givingReceiptSetting)
    .values({ churchId: c.id, ...d })
    .onConflictDoUpdate({ target: givingReceiptSetting.churchId, set: d });

  await audit({
    churchId: c.id,
    action: "giving.receipts.update",
    summary: d.enabled
      ? `Turned giving receipts on (${[d.email && "email", d.sms && "SMS"].filter(Boolean).join(" and ") || "no channel"})`
      : "Turned giving receipts off",
    targetType: "church",
    targetId: c.id,
    meta: { enabled: d.enabled, email: d.email, sms: d.sms },
    severity: "notice",
  });

  revalidatePath("/settings/giving");
  revalidatePath("/giving");
  return { ok: true };
}

/* ----------------------- Pledge installment reminders --------------------- */

const pledgeReminderSchema = z.object({
  enabled: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
  emailSubject: z.string().trim().min(1, "Add an email subject").max(160),
  emailBody: z.string().trim().min(1, "Add an email message").max(2000),
  smsBody: z.string().trim().min(1, "Add an SMS message").max(480),
});

export type PledgeReminderInput = z.input<typeof pledgeReminderSchema>;

export async function savePledgeReminderSettings(
  input: PledgeReminderInput,
): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await canAny(["settings.manage", "giving.manage"]))) return NO_GIVING;
  const parsed = pledgeReminderSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await db
    .insert(pledgeReminderSetting)
    .values({ churchId: c.id, ...d })
    .onConflictDoUpdate({ target: pledgeReminderSetting.churchId, set: d });

  await audit({
    churchId: c.id,
    action: "giving.pledge_reminders.update",
    summary: d.enabled
      ? "Turned pledge reminders on"
      : "Turned pledge reminders off",
    targetType: "church",
    targetId: c.id,
    meta: { enabled: d.enabled, email: d.email, sms: d.sms },
    severity: "notice",
  });

  revalidatePath("/settings/giving");
  return { ok: true };
}
