"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { firstTimerSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  enabled: z.boolean(),
  sms: z.boolean(),
  email: z.boolean(),
  welcomeDelayDays: z.coerce.number().int().min(0).max(30),
  inviteDelayDays: z.coerce.number().int().min(1).max(90),
  welcomeSms: z.string().trim().min(1).max(480),
  welcomeEmailSubject: z.string().trim().min(1).max(160),
  welcomeEmailBody: z.string().trim().min(1).max(4000),
  inviteSms: z.string().trim().min(1).max(480),
  inviteEmailSubject: z.string().trim().min(1).max(160),
  inviteEmailBody: z.string().trim().min(1).max(4000),
});

export type FirstTimerInput = z.input<typeof schema>;

export async function saveFirstTimers(
  input: FirstTimerInput,
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

  if (d.inviteDelayDays < d.welcomeDelayDays)
    return {
      ok: false,
      error: "The invite should be sent after the welcome message.",
    };

  await db
    .insert(firstTimerSetting)
    .values({ churchId: church.id, ...d })
    .onConflictDoUpdate({ target: firstTimerSetting.churchId, set: d });

  await audit({
    churchId: church.id,
    action: "settings.first_timers.update",
    summary: "Updated the first-timer follow-up sequence",
    targetType: "church",
    targetId: church.id,
    meta: { ...d },
  });

  revalidatePath("/settings/first-timers");
  return { ok: true };
}
