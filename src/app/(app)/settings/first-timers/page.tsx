import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firstTimerSetting } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { FirstTimersForm } from "@/components/settings/first-timers-form";

export const metadata = { title: "First-timers · Settings" };

const DEFAULTS = {
  enabled: false,
  sms: false,
  email: true,
  welcomeDelayDays: 1,
  inviteDelayDays: 14,
  welcomeSms:
    "Hi {name}, it was a joy to have you at {church}! 🙏 Thank you for worshipping with us. We'd love to see you again soon.",
  welcomeEmailSubject: "Thank you for visiting {church}, {name}!",
  welcomeEmailBody:
    "Dear {name},\n\nThank you so much for visiting {church}! It was a joy to have you worship with us.\n\nWe'd love to stay connected and see you again. If there's any way we can pray for you or serve you, please let us know.\n\nWith love,\n{church}",
  inviteSms:
    "Hi {name}, we'd love for you to become part of the {church} family! Complete your membership here: {link}",
  inviteEmailSubject: "Become part of the {church} family, {name}",
  inviteEmailBody:
    "Dear {name},\n\nWe've loved having you with us these past couple of weeks. We'd be honoured to have you become a full member of the {church} family.\n\nIt only takes a minute — just complete your details here:\n{link}\n\nWe look forward to walking this journey with you.\n\nWith love,\n{church}",
};

export default async function FirstTimersSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  const [setting] = await db
    .select()
    .from(firstTimerSetting)
    .where(eq(firstTimerSetting.churchId, church.id))
    .limit(1);
  const s = setting ?? DEFAULTS;

  return (
    <FirstTimersForm
      initial={{
        enabled: s.enabled,
        sms: s.sms,
        email: s.email,
        welcomeDelayDays: s.welcomeDelayDays,
        inviteDelayDays: s.inviteDelayDays,
        welcomeSms: s.welcomeSms,
        welcomeEmailSubject: s.welcomeEmailSubject,
        welcomeEmailBody: s.welcomeEmailBody,
        inviteSms: s.inviteSms,
        inviteEmailSubject: s.inviteEmailSubject,
        inviteEmailBody: s.inviteEmailBody,
      }}
      timezone={church.timezone}
      smsApproved={church.smsSenderStatus === "approved"}
    />
  );
}
