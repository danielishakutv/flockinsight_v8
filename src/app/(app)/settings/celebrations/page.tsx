import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { celebrationSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getCelebrationQueue } from "@/lib/celebrations";
import { CELEBRATION_DEFAULTS } from "@/lib/celebration-defaults";
import { CelebrationsForm } from "@/components/settings/celebrations-form";

export const metadata = { title: "Celebrations · Settings" };

export default async function CelebrationsSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  const [[setting], queue] = await Promise.all([
    db
      .select()
      .from(celebrationSetting)
      .where(eq(celebrationSetting.churchId, church.id))
      .limit(1),
    getCelebrationQueue(church.id, 14),
  ]);

  const s = setting ?? CELEBRATION_DEFAULTS;

  return (
    <CelebrationsForm
      initial={{
        enabled: s.enabled,
        sms: s.sms,
        email: s.email,
        sendTime: s.sendTime,
        birthdaySms: s.birthdaySms,
        birthdayEmailSubject: s.birthdayEmailSubject,
        birthdayEmailBody: s.birthdayEmailBody,
        anniversarySms: s.anniversarySms,
        anniversaryEmailSubject: s.anniversaryEmailSubject,
        anniversaryEmailBody: s.anniversaryEmailBody,
      }}
      timezone={church.timezone}
      smsApproved={church.smsSenderStatus === "approved"}
      queue={queue}
    />
  );
}
