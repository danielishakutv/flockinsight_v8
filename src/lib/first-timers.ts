import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, member, firstTimerSetting, firstTimerRun } from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { fillTemplate } from "@/lib/service-reminders";
import { ensureSignup, signupUrl } from "@/lib/member-signup";

export type FirstTimerSummary = {
  churchesChecked: number;
  welcome: number;
  invites: number;
  emails: number;
  sms: number;
};

const DAY_MS = 86_400_000;

/**
 * The first-timer nurture sequence. For each enabled church, sends a welcome
 * (appreciation) message a day or so after a first-timer is registered, then a
 * "become a member" invite (with the church's self-registration link) after a
 * couple of weeks. Idempotent per member per stage (first_timer_run unique).
 * Run daily via cron — timing is date-based, so a missed run self-heals.
 */
export async function runFirstTimers(): Promise<FirstTimerSummary> {
  const churches = await db
    .select({
      churchId: firstTimerSetting.churchId,
      sms: firstTimerSetting.sms,
      email: firstTimerSetting.email,
      welcomeDelayDays: firstTimerSetting.welcomeDelayDays,
      inviteDelayDays: firstTimerSetting.inviteDelayDays,
      welcomeSms: firstTimerSetting.welcomeSms,
      welcomeEmailSubject: firstTimerSetting.welcomeEmailSubject,
      welcomeEmailBody: firstTimerSetting.welcomeEmailBody,
      inviteSms: firstTimerSetting.inviteSms,
      inviteEmailSubject: firstTimerSetting.inviteEmailSubject,
      inviteEmailBody: firstTimerSetting.inviteEmailBody,
      name: church.name,
      handle: church.handle,
    })
    .from(firstTimerSetting)
    .innerJoin(church, eq(church.id, firstTimerSetting.churchId))
    .where(and(eq(firstTimerSetting.enabled, true), eq(church.status, "active")));

  const summary: FirstTimerSummary = {
    churchesChecked: churches.length,
    welcome: 0,
    invites: 0,
    emails: 0,
    sms: 0,
  };

  for (const c of churches) {
    if (!c.sms && !c.email) continue;

    // The self-registration link used in the "become a member" invite.
    const signup = await ensureSignup({
      id: c.churchId,
      name: c.name,
      handle: c.handle,
    });
    const link = signupUrl(signup.slug);

    // Only look at recent first-timers, so enabling the feature never blasts a
    // church's whole visitor history at once.
    const cutoff = new Date(Date.now() - (c.inviteDelayDays + 30) * DAY_MS);

    const members = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
        createdAt: member.createdAt,
      })
      .from(member)
      .where(
        and(
          eq(member.churchId, c.churchId),
          inArray(member.status, ["visitor", "new_convert"]),
          gte(member.createdAt, cutoff),
        ),
      )
      .limit(2000);

    const smsRecipients: { phone: string; message: string }[] = [];
    const emailJobs: { to: string; subject: string; body: string }[] = [];

    for (const m of members) {
      const ageDays = Math.floor(
        (Date.now() - new Date(m.createdAt).getTime()) / DAY_MS,
      );
      const vars = { name: m.firstName, church: c.name, link };

      const stages: {
        stage: "welcome" | "invite";
        due: boolean;
        sms: string;
        subject: string;
        body: string;
      }[] = [
        {
          stage: "welcome",
          due: ageDays >= c.welcomeDelayDays,
          sms: c.welcomeSms,
          subject: c.welcomeEmailSubject,
          body: c.welcomeEmailBody,
        },
        {
          stage: "invite",
          due: ageDays >= c.inviteDelayDays,
          sms: c.inviteSms,
          subject: c.inviteEmailSubject,
          body: c.inviteEmailBody,
        },
      ];

      for (const s of stages) {
        if (!s.due) continue;
        // Claim this stage for this member (idempotent).
        const [run] = await db
          .insert(firstTimerRun)
          .values({ churchId: c.churchId, memberId: m.id, stage: s.stage })
          .onConflictDoNothing()
          .returning({ id: firstTimerRun.id });
        if (!run) continue;

        if (s.stage === "welcome") summary.welcome++;
        else summary.invites++;

        if (c.sms && m.phone)
          smsRecipients.push({ phone: m.phone, message: fillTemplate(s.sms, vars) });
        if (c.email && m.email)
          emailJobs.push({
            to: m.email,
            subject: fillTemplate(s.subject, vars),
            body: fillTemplate(s.body, vars),
          });
      }
    }

    let emails = 0;
    for (const job of emailJobs) {
      try {
        const ok = await sendEmail({
          to: job.to,
          subject: job.subject,
          html: emailLayout(job.subject, job.body.replace(/\n/g, "<br>")),
          text: job.body,
          fromName: c.name,
        });
        if (ok) emails++;
      } catch {
        /* keep going */
      }
    }
    if (emails > 0) await recordUsage("email", c.churchId, emails);
    summary.emails += emails;

    if (smsRecipients.length) {
      const res = await sendChurchSmsBatch({
        churchId: c.churchId,
        recipients: smsRecipients,
        label: "First-timer welcome & invites",
      });
      if (res.ok) summary.sms += res.sent;
    }
  }

  return summary;
}
