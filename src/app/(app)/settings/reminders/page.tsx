import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reminderSetting, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { RemindersForm } from "@/components/settings/reminders-form";
import { REMINDER_DEFAULTS } from "@/lib/reminder-defaults";

export const metadata = { title: "Reminders · Settings" };

export default async function RemindersSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  const [setting] = await db
    .select()
    .from(reminderSetting)
    .where(eq(reminderSetting.churchId, church.id))
    .limit(1);

  const services = await db
    .select({ id: service.id })
    .from(service)
    .where(and(eq(service.churchId, church.id), eq(service.isActive, true)));

  const s = setting ?? REMINDER_DEFAULTS;

  return (
    <RemindersForm
      initial={{
        enabled: s.enabled,
        sms: s.sms,
        email: s.email,
        dayBefore: s.dayBefore,
        sendTime: s.sendTime,
        audience: s.audience as "active" | "all",
        smsTemplate: s.smsTemplate,
        emailSubject: s.emailSubject,
        emailTemplate: s.emailTemplate,
      }}
      serviceCount={services.length}
      timezone={church.timezone}
      smsApproved={church.smsSenderStatus === "approved"}
      smsBalance={church.walletBalance}
    />
  );
}
