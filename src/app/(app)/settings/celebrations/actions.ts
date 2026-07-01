"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { celebrationSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { fillTemplate } from "@/lib/service-reminders";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  enabled: z.boolean(),
  sms: z.boolean(),
  email: z.boolean(),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24h time like 08:00"),
  birthdaySms: z.string().trim().min(1).max(480),
  birthdayEmailSubject: z.string().trim().min(1).max(160),
  birthdayEmailBody: z.string().trim().min(1).max(4000),
  anniversarySms: z.string().trim().min(1).max(480),
  anniversaryEmailSubject: z.string().trim().min(1).max(160),
  anniversaryEmailBody: z.string().trim().min(1).max(4000),
});

export type CelebrationInput = z.input<typeof schema>;

export async function saveCelebrations(
  input: CelebrationInput,
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await db
    .insert(celebrationSetting)
    .values({ churchId: church.id, ...d })
    .onConflictDoUpdate({ target: celebrationSetting.churchId, set: d });

  revalidatePath("/settings/celebrations");
  return { ok: true };
}

export async function sendTestCelebration(
  input: CelebrationInput,
): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const vars = {
    name: user.name?.split(" ")[0] || "Friend",
    church: church.name,
    occasion: "wedding anniversary",
    years: "5",
  };
  const subject = `[Test] ${fillTemplate(d.birthdayEmailSubject, vars)}`;
  const body = fillTemplate(d.birthdayEmailBody, vars);
  try {
    const ok = await sendEmail({
      to: user.email,
      subject,
      html: emailLayout(fillTemplate(d.birthdayEmailSubject, vars), body.replace(/\n/g, "<br>")),
      text: body,
      fromName: church.name,
    });
    if (!ok) return { ok: false, error: "Could not send the test email." };
  } catch {
    return { ok: false, error: "Could not send the test email." };
  }
  return { ok: true };
}
