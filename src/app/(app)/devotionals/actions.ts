"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devotional, subscriber } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendDevotional } from "@/lib/devotionals";

export type ActionResult =
  | { ok: true; id?: string; sent?: number; recipients?: number }
  | { ok: false; error: string };

const saveSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["devotional", "newsletter"]),
  title: z.string().trim().min(1, "Add a title.").max(200),
  body: z.string().trim().min(1, "Write some content.").max(20000),
  imageUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(500).nullable(),
  ),
  audience: z.enum(["subscribers", "members", "both"]),
});

export type DevotionalInput = z.input<typeof saveSchema>;

/** Create a blank draft and return its id. */
export async function createDevotional(
  type: "devotional" | "newsletter",
): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("devotionals.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const t = type === "newsletter" ? "newsletter" : "devotional";
  const [row] = await db
    .insert(devotional)
    .values({
      churchId: church.id,
      type: t,
      title: t === "newsletter" ? "Untitled newsletter" : "Untitled devotional",
      body: "",
      createdBy: user.id,
    })
    .returning({ id: devotional.id });
  revalidatePath("/devotionals");
  return { ok: true, id: row.id };
}

/**
 * Save content, then either keep as draft, schedule, or send now.
 */
export async function saveDevotional(
  input: DevotionalInput,
  mode: "draft" | "schedule" | "send",
  scheduledAt?: string,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("devotionals.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid." };
  const d = parsed.data;

  const [existing] = await db
    .select({ id: devotional.id, status: devotional.status })
    .from(devotional)
    .where(and(eq(devotional.id, d.id), eq(devotional.churchId, church.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Not found." };
  if (existing.status === "sent")
    return { ok: false, error: "This has already been sent." };

  // Save the content first.
  await db
    .update(devotional)
    .set({
      type: d.type,
      title: d.title,
      body: d.body,
      imageUrl: d.imageUrl,
      audience: d.audience,
    })
    .where(and(eq(devotional.id, d.id), eq(devotional.churchId, church.id)));

  if (mode === "schedule") {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (!when || isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000)
      return { ok: false, error: "Pick a future date and time." };
    await db
      .update(devotional)
      .set({ status: "scheduled", scheduledAt: when })
      .where(eq(devotional.id, d.id));
    revalidatePath("/devotionals");
    return { ok: true, id: d.id };
  }

  if (mode === "send") {
    const res = await sendDevotional(d.id);
    revalidatePath("/devotionals");
    if (!res.ok) return res;
    return { ok: true, id: d.id, sent: res.sent, recipients: res.recipients };
  }

  // draft
  await db
    .update(devotional)
    .set({ status: "draft", scheduledAt: null })
    .where(eq(devotional.id, d.id));
  revalidatePath("/devotionals");
  return { ok: true, id: d.id };
}

export async function deleteDevotional(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("devotionals.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };
  const res = await db
    .delete(devotional)
    .where(and(eq(devotional.id, id), eq(devotional.churchId, church.id)))
    .returning({ id: devotional.id });
  if (!res.length) return { ok: false, error: "Not found." };
  revalidatePath("/devotionals");
  return { ok: true };
}

/* ----- Subscribers ----- */

export async function addSubscriber(
  name: string,
  email: string,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("devotionals.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const clean = z.string().email().max(160).safeParse(email.trim().toLowerCase());
  if (!clean.success) return { ok: false, error: "Enter a valid email." };
  await db
    .insert(subscriber)
    .values({
      churchId: church.id,
      name: name.trim().slice(0, 120) || null,
      email: clean.data,
      source: "manual",
    })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      set: { status: "active", name: name.trim().slice(0, 120) || null },
    });
  revalidatePath("/devotionals");
  return { ok: true };
}

export async function removeSubscriber(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("devotionals.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };
  await db
    .delete(subscriber)
    .where(and(eq(subscriber.id, id), eq(subscriber.churchId, church.id)));
  revalidatePath("/devotionals");
  return { ok: true };
}
