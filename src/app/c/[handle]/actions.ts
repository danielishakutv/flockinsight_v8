"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, subscriber } from "@/db/schema";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { unsubscribeUrl } from "@/lib/devotionals";

export type SubscribeResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  handle: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(160),
});

/** Public newsletter sign-up from a church's public page. */
export async function subscribeNewsletter(input: {
  handle: string;
  name?: string;
  email: string;
}): Promise<SubscribeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid." };
  const d = parsed.data;

  const [c] = await db
    .select({ id: church.id, name: church.name, publicEmail: church.publicEmail })
    .from(church)
    .where(and(eq(church.handle, d.handle), eq(church.publicEnabled, true)))
    .limit(1);
  if (!c) return { ok: false, error: "Church not found." };

  const name = d.name?.trim().slice(0, 120) || null;

  // Was this person already an active subscriber? If so, don't re-notify or
  // re-send the welcome email — just keep their record current.
  const [existing] = await db
    .select({ id: subscriber.id, status: subscriber.status })
    .from(subscriber)
    .where(and(eq(subscriber.churchId, c.id), eq(subscriber.email, d.email)))
    .limit(1);
  const alreadyActive = existing?.status === "active";

  await db
    .insert(subscriber)
    .values({ churchId: c.id, name, email: d.email, source: "public" })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      set: { status: "active", ...(name ? { name } : {}) },
    });

  if (!alreadyActive) {
    // Instant in-app notification to the church's managers.
    await notifyChurchManagers({
      churchId: c.id,
      title: "New newsletter subscriber",
      body: `${name || d.email} just subscribed to your mailing list.`,
      linkUrl: "/devotionals",
    }).catch(() => {});

    // Welcome/acknowledgement email to the subscriber.
    if (isEmailConfigured()) {
      const html = emailLayout(
        `You're subscribed to ${escapeHtml(c.name)}`,
        `<p>Hi${name ? " " + escapeHtml(name) : ""},</p><p>Thanks for subscribing to <strong>${escapeHtml(c.name)}</strong>. You'll now receive our devotionals, newsletters and updates by email.</p><p style="font-size:12px;color:#9b97ad">Didn't sign up? You can <a href="${unsubscribeUrl(c.id, d.email)}" style="color:#9b97ad">unsubscribe here</a>.</p>`,
      );
      await sendEmail({
        to: d.email,
        subject: `You're subscribed to ${c.name}`,
        html,
        fromName: c.name,
        replyTo: c.publicEmail || undefined,
      }).catch(() => false);
    }
  }

  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
