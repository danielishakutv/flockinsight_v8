"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { celebrationSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { sendEmail, plainTextEmailLayout } from "@/lib/mailer";
import { fillTemplate } from "@/lib/service-reminders";
import { SMS_WINDOW_END_HOUR, minutesFromHHMM } from "@/lib/sms-window";

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
  /*
   * SMS only where it can be delivered (lib/country-profile.ts). The form no
   * longer offers it elsewhere; this stops a stale or hand-posted "on"
   * being saved, which had the cron try, be refused, and reach nobody.
   */
  const d = {
    ...parsed.data,
    sms: parsed.data.sms && smsAvailableForCountry(church.country),
  };
  /*
   * Networks deliver SMS from 8am to 8pm where the church is. A greeting
   * handed over after 8pm waits for the morning, so "celebrates you today"
   * would arrive the day after. The cron now refuses to text it that late, so
   * an evening send time with SMS on would text nobody. Not asked of a church
   * switching greetings off, which must always be able to save.
   */
  if (d.enabled && d.sms && minutesFromHHMM(d.sendTime) >= SMS_WINDOW_END_HOUR * 60)
    return {
      ok: false,
      error: `Texts can only be delivered between 8am and 8pm, so an SMS greeting can't go at ${d.sendTime}. Choose a send time before 20:00 (18:00 or earlier leaves room for a retry the same day), or turn SMS off.`,
    };

  await db
    .insert(celebrationSetting)
    .values({ churchId: church.id, ...d })
    .onConflictDoUpdate({ target: celebrationSetting.churchId, set: d });

  await audit({
    churchId: church.id,
    action: "settings.celebrations.update",
    summary: "Updated the birthday and anniversary greeting settings",
    targetType: "church",
    targetId: church.id,
    meta: { ...d },
  });

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
      html: plainTextEmailLayout(fillTemplate(d.birthdayEmailSubject, vars), body),
      text: body,
      fromName: church.name,
    });
    if (!ok) return { ok: false, error: "Could not send the test email." };
  } catch {
    return { ok: false, error: "Could not send the test email." };
  }
  return { ok: true };
}
