"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcast } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import {
  deliverBroadcast,
  type BroadcastAudience,
} from "@/lib/broadcasts";
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

/* ------------------------------------------------------------------ *
 * Drafts
 *
 * A draft is a broadcast with no send time and status "draft". Keeping it in
 * the same table as scheduled and sent ones means a draft carries the same
 * audience and channel fields, and becomes a real send by changing two
 * columns rather than by being copied into another shape.
 * ------------------------------------------------------------------ */

/** Save a new draft, or overwrite an existing one. */
export async function saveDraft(
  input: z.input<typeof schema> & { id?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  // A draft is allowed to be incomplete in ways a send is not — you might not
  // have chosen the audience yet. Only the parts that are filled in are
  // checked, and validate() runs in full at send time.
  if (!d.title.trim()) return { ok: false, error: "Give it a title." };

  const values = {
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
    scheduledAt: null,
    status: "draft" as const,
  };

  if (input.id) {
    if (!z.string().uuid().safeParse(input.id).success)
      return { ok: false, error: "Invalid id" };
    const [row] = await db
      .update(broadcast)
      .set(values)
      .where(and(eq(broadcast.id, input.id), eq(broadcast.status, "draft")))
      .returning({ id: broadcast.id });
    if (!row) return { ok: false, error: "That draft no longer exists." };
    revalidatePath("/superadmin/notifications");
    return { ok: true, id: row.id };
  }

  const [row] = await db
    .insert(broadcast)
    .values({ ...values, createdBy: admin.id })
    .returning({ id: broadcast.id });

  revalidatePath("/superadmin/notifications");
  return { ok: true, id: row.id };
}

/**
 * Send a draft, now or at a time.
 *
 * The full validation runs here rather than at save time: a draft may be
 * half-finished, but nothing goes to a church without an audience and a
 * channel.
 */
export async function sendDraft(
  id: string,
  when?: string | null,
): Promise<CreateResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [d] = await db
    .select()
    .from(broadcast)
    .where(and(eq(broadcast.id, id), eq(broadcast.status, "draft")))
    .limit(1);
  if (!d) return { ok: false, error: "That draft no longer exists." };

  const err = validate({
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
  } as Parsed);
  if (err) return { ok: false, error: err };

  const at = when ? new Date(when) : null;
  if (at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 30_000) {
    await db
      .update(broadcast)
      .set({ status: "scheduled", scheduledAt: at })
      .where(and(eq(broadcast.id, id), eq(broadcast.status, "draft")));
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "schedule_broadcast",
      summary: `Scheduled draft "${d.title}" for ${at.toISOString()}`,
      targetType: "broadcast",
      targetId: id,
    });
    revalidatePath("/superadmin/notifications");
    return { ok: true, pushSent: 0, emailSent: 0, scheduled: true };
  }

  // Claim it before delivering, so two clicks cannot send it twice.
  const [claimed] = await db
    .update(broadcast)
    .set({ status: "sent", sentAt: new Date(), scheduledAt: new Date() })
    .where(and(eq(broadcast.id, id), eq(broadcast.status, "draft")))
    .returning({ id: broadcast.id });
  if (!claimed) return { ok: false, error: "That draft was already sent." };

  // The column's enum also carries "user", used by per-user notifications.
  // A broadcast never targets one, so narrow it rather than cast the row.
  const audience: BroadcastAudience =
    d.audience === "user" ? "all" : d.audience;

  const { pushSent, emailSent } = await deliverBroadcast({
    title: d.title,
    body: d.body,
    category: d.category,
    audience,
    targetPlan: d.targetPlan,
    targetCountry: d.targetCountry,
    churchIds: d.churchIds,
    linkUrl: d.linkUrl,
    inApp: d.inApp,
    email: d.email,
    createdBy: admin.id,
  });
  await db
    .update(broadcast)
    .set({ pushSent, emailSent })
    .where(eq(broadcast.id, id));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "send_broadcast",
    summary: `Sent draft "${d.title}" (${d.audience}) · ${emailSent} emails, ${pushSent} push`,
    targetType: "broadcast",
    targetId: id,
  });
  revalidatePath("/superadmin/notifications");
  return { ok: true, pushSent, emailSent };
}

export async function deleteDraft(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [row] = await db
    .delete(broadcast)
    .where(and(eq(broadcast.id, id), eq(broadcast.status, "draft")))
    .returning({ title: broadcast.title });
  if (!row) return { ok: false, error: "That draft no longer exists." };

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "delete_draft",
    summary: `Deleted draft "${row.title}"`,
    targetType: "broadcast",
  });
  revalidatePath("/superadmin/notifications");
  return { ok: true };
}
