"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcast } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { deliverBroadcast } from "@/lib/broadcasts";
import { recordAudit } from "@/lib/audit";

export type CreateResult =
  | { ok: true; pushSent: number; emailSent: number; scheduled?: boolean }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  body: z.string().trim().min(1, "Message is required").max(2000),
  category: z.enum(["system", "general"]),
  audience: z.enum(["all", "plan", "country", "churches"]),
  targetPlan: z.preprocess(
    emptyToNull,
    z.enum(["starter", "growth", "pro", "enterprise"]).nullable(),
  ),
  targetCountry: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  churchIds: z.array(z.string()).default([]),
  linkUrl: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  inApp: z.boolean().default(true),
  email: z.boolean().default(false),
  // ISO datetime; when present & in the future the broadcast is scheduled.
  scheduledAt: z.preprocess(emptyToNull, z.string().nullable()).optional(),
});

type Parsed = z.infer<typeof schema>;

function validate(d: Parsed): string | null {
  if (!d.inApp && !d.email) return "Pick at least one channel (in-app or email).";
  if (d.audience === "plan" && !d.targetPlan) return "Choose a plan to target.";
  if (d.audience === "country" && !d.targetCountry) return "Choose a country to target.";
  if (d.audience === "churches" && d.churchIds.length === 0)
    return "Pick at least one church.";
  return null;
}

export async function createNotification(
  input: z.input<typeof schema>,
): Promise<CreateResult> {
  const admin = await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  const err = validate(d);
  if (err) return { ok: false, error: err };

  // Scheduled for later?
  const when = d.scheduledAt ? new Date(d.scheduledAt) : null;
  if (when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 30_000) {
    await db.insert(broadcast).values({
      title: d.title,
      body: d.body,
      category: d.category,
      audience: d.audience,
      targetPlan: d.audience === "plan" ? d.targetPlan : null,
      targetCountry: d.audience === "country" ? d.targetCountry : null,
      churchIds: d.audience === "churches" ? d.churchIds : [],
      linkUrl: d.linkUrl,
      inApp: d.inApp,
      email: d.email,
      scheduledAt: when,
      createdBy: admin.id,
    });
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "schedule_broadcast",
      summary: `Scheduled broadcast "${d.title}" for ${when.toISOString()}`,
      targetType: "broadcast",
    });
    revalidatePath("/superadmin/notifications");
    return { ok: true, pushSent: 0, emailSent: 0, scheduled: true };
  }

  // Send now.
  const { pushSent, emailSent } = await deliverBroadcast({
    title: d.title,
    body: d.body,
    category: d.category,
    audience: d.audience,
    targetPlan: d.targetPlan,
    targetCountry: d.targetCountry,
    churchIds: d.churchIds,
    linkUrl: d.linkUrl,
    inApp: d.inApp,
    email: d.email,
    createdBy: admin.id,
  });
  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "send_broadcast",
    summary: `Sent broadcast "${d.title}" (${d.audience}) · ${emailSent} emails, ${pushSent} push`,
    targetType: "broadcast",
  });
  revalidatePath("/superadmin/notifications");
  return { ok: true, pushSent, emailSent };
}

export async function cancelBroadcast(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const [b] = await db
    .update(broadcast)
    .set({ status: "cancelled" })
    .where(eq(broadcast.id, id))
    .returning({ title: broadcast.title });
  if (b) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "cancel_broadcast",
      summary: `Cancelled scheduled broadcast "${b.title}"`,
      targetType: "broadcast",
      targetId: id,
    });
  }
  revalidatePath("/superadmin/notifications");
  return { ok: true };
}
