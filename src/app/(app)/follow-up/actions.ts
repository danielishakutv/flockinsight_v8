"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { followUpInteraction, member, staff } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { sendSms, isSmsConfigured } from "@/lib/sms";

export type ActionResult = { ok: true } | { ok: false; error: string };

const INTERACTION_TYPES = [
  "visit",
  "call",
  "sms",
  "whatsapp",
  "email",
  "note",
] as const;
const OUTCOMES = ["reached", "no_response", "scheduled", "not_interested"] as const;
const STATUSES = [
  "new",
  "contacted",
  "in_progress",
  "joined",
  "not_interested",
] as const;

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

/** Ensure a member belongs to the active church; returns it or null. */
async function memberInChurch(memberId: string, churchId: string) {
  const [m] = await db
    .select({ id: member.id, phone: member.phone, followUpStatus: member.followUpStatus })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.churchId, churchId)))
    .limit(1);
  return m ?? null;
}

const logSchema = z.object({
  memberId: z.string().uuid(),
  type: z.enum(INTERACTION_TYPES),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  outcome: z.preprocess(emptyToNull, z.enum(OUTCOMES).nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable()),
});

export async function logInteraction(
  input: z.input<typeof logSchema>,
): Promise<ActionResult> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();

  const m = await memberInChurch(d.memberId, church.id);
  if (!m) return { ok: false, error: "Member not found." };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(followUpInteraction).values({
        churchId: church.id,
        memberId: d.memberId,
        type: d.type,
        outcome: d.outcome,
        notes: d.notes,
        occurredAt: d.occurredAt,
        createdBy: user.id,
      });
      await tx
        .update(member)
        .set({
          lastContactedAt: new Date(),
          // First touch moves an untracked person into "contacted".
          followUpStatus: m.followUpStatus ?? "contacted",
        })
        .where(eq(member.id, d.memberId));
    });
    revalidatePath("/follow-up");
    revalidatePath(`/follow-up/${d.memberId}`);
    return { ok: true };
  } catch (e) {
    console.error("logInteraction failed", e);
    return { ok: false, error: "Could not save the interaction." };
  }
}

const smsSchema = z.object({
  memberId: z.string().uuid(),
  message: z.string().trim().min(1, "Message is empty").max(800),
});

export async function sendSmsToMember(
  input: z.input<typeof smsSchema>,
): Promise<ActionResult> {
  const parsed = smsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  const { memberId, message } = parsed.data;
  const { church, user } = await requireChurch();

  if (!isSmsConfigured()) {
    return { ok: false, error: "SMS isn't set up on this server yet." };
  }

  const m = await memberInChurch(memberId, church.id);
  if (!m) return { ok: false, error: "Member not found." };
  if (!m.phone) return { ok: false, error: "This member has no phone number." };

  const result = await sendSms({ to: m.phone, message });
  if (!result.ok) return result;

  // Log the successful SMS as an interaction.
  const today = new Date().toISOString().slice(0, 10);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(followUpInteraction).values({
        churchId: church.id,
        memberId,
        type: "sms",
        outcome: "reached",
        notes: message,
        occurredAt: today,
        createdBy: user.id,
      });
      await tx
        .update(member)
        .set({
          lastContactedAt: new Date(),
          followUpStatus: m.followUpStatus ?? "contacted",
        })
        .where(eq(member.id, memberId));
    });
  } catch (e) {
    // The SMS was sent; just couldn't log it. Don't fail the user action.
    console.error("sms logged-interaction failed", e);
  }
  revalidatePath("/follow-up");
  revalidatePath(`/follow-up/${memberId}`);
  return { ok: true };
}

export async function setFollowUpStatus(
  memberId: string,
  status: (typeof STATUSES)[number],
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(memberId).success)
    return { ok: false, error: "Invalid id" };
  if (!STATUSES.includes(status))
    return { ok: false, error: "Invalid status" };
  const { church } = await requireChurch();

  await db
    .update(member)
    .set({ followUpStatus: status })
    .where(and(eq(member.id, memberId), eq(member.churchId, church.id)));
  revalidatePath("/follow-up");
  revalidatePath(`/follow-up/${memberId}`);
  return { ok: true };
}

export async function assignFollowUp(
  memberId: string,
  userId: string | null,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(memberId).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();

  if (userId) {
    // Only allow assigning to someone on the church team.
    const [isStaff] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.organizationId, church.id), eq(staff.userId, userId)))
      .limit(1);
    if (!isStaff) return { ok: false, error: "That person isn't on your team." };
  }

  await db
    .update(member)
    .set({ assignedToId: userId })
    .where(and(eq(member.id, memberId), eq(member.churchId, church.id)));
  revalidatePath("/follow-up");
  revalidatePath(`/follow-up/${memberId}`);
  return { ok: true };
}

export async function setInFollowUp(
  memberId: string,
  inFollowUp: boolean,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(memberId).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();

  const m = await memberInChurch(memberId, church.id);
  if (!m) return { ok: false, error: "Member not found." };

  await db
    .update(member)
    .set({
      inFollowUp,
      followUpStatus: inFollowUp ? (m.followUpStatus ?? "new") : m.followUpStatus,
    })
    .where(and(eq(member.id, memberId), eq(member.churchId, church.id)));
  revalidatePath("/follow-up");
  return { ok: true };
}
