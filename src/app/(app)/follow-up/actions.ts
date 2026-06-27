"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { followUpInteraction, member, staff, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendChurchSms } from "@/lib/church-sms";
import { notifyUser } from "@/lib/notifications";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

export type ActionResult = { ok: true } | { ok: false; error: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  if (!(await can("followup.manage")))
    return { ok: false, error: "You don't have permission to manage follow-up." };

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
  if (!(await can("followup.manage")))
    return { ok: false, error: "You don't have permission to manage follow-up." };

  const m = await memberInChurch(memberId, church.id);
  if (!m) return { ok: false, error: "Member not found." };
  if (!m.phone) return { ok: false, error: "This member has no phone number." };

  // Uses the church's approved sender ID and deducts from its SMS wallet.
  const result = await sendChurchSms({
    churchId: church.id,
    to: m.phone,
    message,
    userId: user.id,
    reason: "Follow-up SMS",
  });
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
  if (!(await can("followup.manage")))
    return { ok: false, error: "You don't have permission to manage follow-up." };

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
  const { church, user: me } = await requireChurch();
  if (!(await can("followup.manage")))
    return { ok: false, error: "You don't have permission to manage follow-up." };

  if (userId) {
    // Only allow assigning to someone on the church team.
    const [isStaff] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.organizationId, church.id), eq(staff.userId, userId)))
      .limit(1);
    if (!isStaff) return { ok: false, error: "That person isn't on your team." };
  }

  // Load the member (name + current assignee) to detect a real change.
  const [m] = await db
    .select({
      firstName: member.firstName,
      lastName: member.lastName,
      assignedToId: member.assignedToId,
    })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.churchId, church.id)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };

  await db
    .update(member)
    .set({ assignedToId: userId })
    .where(and(eq(member.id, memberId), eq(member.churchId, church.id)));
  revalidatePath("/follow-up");
  revalidatePath(`/follow-up/${memberId}`);

  // Alert the newly assigned person (skip if unchanged, or self-assigned).
  if (userId && userId !== m.assignedToId && userId !== me.id) {
    const [assignee] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (assignee) {
      const memberName =
        [m.firstName, m.lastName].filter(Boolean).join(" ") || "a member";
      const link = `/follow-up/${memberId}`;

      await notifyUser({
        userId,
        title: "New follow-up assignment",
        body: `${me.name} assigned you to follow up with ${memberName} at ${church.name}.`,
        linkUrl: link,
      });

      try {
        await sendEmail({
          to: assignee.email,
          subject: `You've been assigned to follow up with ${memberName}`,
          html: emailLayout(
            "New follow-up assignment",
            `<p>Hi ${escapeHtml(assignee.name?.split(" ")[0] || "there")},</p>` +
              `<p><strong>${escapeHtml(me.name)}</strong> assigned you to follow up with <strong>${escapeHtml(memberName)}</strong> at <strong>${escapeHtml(church.name)}</strong>.</p>` +
              `<p>Open their profile to see the history and log your visits, calls and notes.</p>`,
            { label: "Open follow-up", url: `${siteUrl()}${link}` },
          ),
          text: `${me.name} assigned you to follow up with ${memberName} at ${church.name}. ${siteUrl()}${link}`,
        });
      } catch (e) {
        console.error("[follow-up] assignment email failed", e);
      }
    }
  }

  return { ok: true };
}

export async function setInFollowUp(
  memberId: string,
  inFollowUp: boolean,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(memberId).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
  if (!(await can("followup.manage")))
    return { ok: false, error: "You don't have permission to manage follow-up." };

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
