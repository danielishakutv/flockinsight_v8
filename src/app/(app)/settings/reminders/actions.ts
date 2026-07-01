"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reminderSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { fillTemplate } from "@/lib/service-reminders";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  enabled: z.boolean(),
  sms: z.boolean(),
  email: z.boolean(),
  dayBefore: z.boolean(),
  sendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24h time like 07:00"),
  audience: z.enum(["active", "all"]),
  smsTemplate: z.string().trim().min(1).max(480),
  emailSubject: z.string().trim().min(1).max(160),
  emailTemplate: z.string().trim().min(1).max(4000),
});

export type ReminderInput = z.input<typeof schema>;

export async function saveReminders(input: ReminderInput): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await db
    .insert(reminderSetting)
    .values({ churchId: church.id, ...d })
    .onConflictDoUpdate({ target: reminderSetting.churchId, set: d });

  revalidatePath("/settings/reminders");
  return { ok: true };
}

/** Send the current admin a sample of the reminder, to preview it. */
export async function sendTestReminder(
  input: ReminderInput,
): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const vars = {
    name: user.name?.split(" ")[0] || "there",
    church: church.name,
    service: "Sunday Service",
    day: "Sunday",
    time: "9:00 AM",
  };
  const subject = fillTemplate(d.emailSubject, vars);
  const body = fillTemplate(d.emailTemplate, vars);
  try {
    const ok = await sendEmail({
      to: user.email,
      subject: `[Test] ${subject}`,
      html: emailLayout(subject, body.replace(/\n/g, "<br>")),
      text: body,
      fromName: church.name,
    });
    if (!ok) return { ok: false, error: "Could not send the test email." };
  } catch {
    return { ok: false, error: "Could not send the test email." };
  }
  return { ok: true };
}
