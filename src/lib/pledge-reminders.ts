import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  member,
  pledge,
  pledgeReminderRun,
  pledgeReminderSetting,
  project,
} from "@/db/schema";
import { paidByPledge, cadenceLabel } from "@/lib/projects";
import type { PledgeCadence } from "@/lib/projects-shared";
import { sendChurchSms } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { smsPages } from "@/lib/sms";
import { recordUsage } from "@/lib/usage";
import { formatMoney } from "@/lib/money";

/* ============================================================
 * Pledge installment reminders — nudge members with an outstanding pledge once
 * per cadence period, until it's paid off. Idempotent per pledge per period
 * (pledge_reminder_run unique index). Bundled into the daily reminders cron.
 * ========================================================== */

export type PledgeReminderSummary = {
  churchesChecked: number;
  reminders: number;
  emails: number;
  sms: number;
};

export type PledgeReminderConfig = {
  enabled: boolean;
  email: boolean;
  sms: boolean;
  emailSubject: string;
  emailBody: string;
  smsBody: string;
};

const REMINDER_DEFAULTS: PledgeReminderConfig = {
  enabled: false,
  email: true,
  sms: false,
  emailSubject: "A note about your {project} pledge — {church}",
  emailBody:
    "Dear {name},\n\nThank you for your pledge of {amount} toward {project}. So far {paid} has been received, leaving {outstanding} outstanding. Whenever you're able to give your {cadence} portion, it's a great blessing to the work.\n\n\"Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver.\" (2 Corinthians 9:7)\n\nGod bless you,\n{church}",
  smsBody:
    "Dear {name}, thank you for your {project} pledge. {paid} received, {outstanding} outstanding. God bless you! — {church}",
};

/** A church's pledge-reminder settings, falling back to defaults when unset. */
export async function getPledgeReminderSetting(
  churchId: string,
): Promise<PledgeReminderConfig> {
  const [row] = await db
    .select()
    .from(pledgeReminderSetting)
    .where(eq(pledgeReminderSetting.churchId, churchId))
    .limit(1);
  if (!row) return { ...REMINDER_DEFAULTS };
  return {
    enabled: row.enabled,
    email: row.email,
    sms: row.sms,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
    smsBody: row.smsBody,
  };
}

/** Today's date (YYYY-MM-DD) in a church timezone. */
function localDate(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * How many whole cadence periods have elapsed from `start` to `today` (both
 * YYYY-MM-DD). Used to nudge once at the start of each new period. Returns -1
 * for cadences we don't schedule (one-time / custom).
 */
function periodIndex(cadence: PledgeCadence, start: string, today: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  if (t <= s) return 0;
  if (cadence === "weekly") {
    const days = Math.floor((t.getTime() - s.getTime()) / 86_400_000);
    return Math.floor(days / 7);
  }
  // Calendar-month difference (docked a month if today's day-of-month is earlier).
  const months =
    (t.getUTCFullYear() - s.getUTCFullYear()) * 12 +
    (t.getUTCMonth() - s.getUTCMonth()) -
    (t.getUTCDate() < s.getUTCDate() ? 1 : 0);
  if (cadence === "monthly") return months;
  if (cadence === "quarterly") return Math.floor(months / 3);
  if (cadence === "yearly") return Math.floor(months / 12);
  return -1; // one_time / custom — no scheduled reminder
}

export async function runPledgeReminders(): Promise<PledgeReminderSummary> {
  const churches = await db
    .select({
      churchId: pledgeReminderSetting.churchId,
      email: pledgeReminderSetting.email,
      sms: pledgeReminderSetting.sms,
      emailSubject: pledgeReminderSetting.emailSubject,
      emailBody: pledgeReminderSetting.emailBody,
      smsBody: pledgeReminderSetting.smsBody,
      name: church.name,
      timezone: church.timezone,
      currency: church.currency,
    })
    .from(pledgeReminderSetting)
    .innerJoin(church, eq(church.id, pledgeReminderSetting.churchId))
    .where(
      and(eq(pledgeReminderSetting.enabled, true), eq(church.status, "active")),
    );

  const summary: PledgeReminderSummary = {
    churchesChecked: churches.length,
    reminders: 0,
    emails: 0,
    sms: 0,
  };

  for (const c of churches) {
    if (!c.email && !c.sms) continue;
    const today = localDate(c.timezone || "Africa/Lagos");

    // Active pledges on active projects, for members we can actually reach.
    const rows = await db
      .select({
        id: pledge.id,
        amount: pledge.amount,
        cadence: pledge.cadence,
        cadenceLabel: pledge.cadenceLabel,
        startDate: pledge.startDate,
        createdAt: pledge.createdAt,
        projectName: project.name,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
      })
      .from(pledge)
      .innerJoin(
        project,
        and(eq(project.id, pledge.projectId), eq(project.status, "active")),
      )
      .innerJoin(member, eq(member.id, pledge.memberId))
      .where(
        and(
          eq(pledge.churchId, c.churchId),
          eq(pledge.status, "active"),
          inArray(pledge.cadence, ["weekly", "monthly", "quarterly", "yearly"]),
          isNotNull(pledge.memberId),
        ),
      );
    if (rows.length === 0) continue;

    const paid = await paidByPledge(
      c.churchId,
      rows.map((r) => r.id),
    );

    for (const r of rows) {
      const hasContact = (c.email && r.email) || (c.sms && r.phone);
      if (!hasContact) continue;

      const amount = Number(r.amount);
      const paidAmt = paid.get(r.id) ?? 0;
      const outstanding = amount - paidAmt;
      if (outstanding <= 0) continue;

      const start = r.startDate || r.createdAt.toISOString().slice(0, 10);
      const idx = periodIndex(r.cadence, start, today);
      if (idx < 1) continue; // still in the first period — don't nag yet

      const periodKey = `${r.cadence}:${idx}`;

      // Claim this period; if it exists, we've already reminded for it.
      const [run] = await db
        .insert(pledgeReminderRun)
        .values({ churchId: c.churchId, pledgeId: r.id, periodKey })
        .onConflictDoNothing()
        .returning({ id: pledgeReminderRun.id });
      if (!run) continue;

      const vars: Record<string, string> = {
        name: r.firstName || "friend",
        project: r.projectName,
        amount: formatMoney(amount, c.currency),
        paid: formatMoney(paidAmt, c.currency),
        outstanding: formatMoney(outstanding, c.currency),
        cadence: cadenceLabel(r.cadence, r.cadenceLabel).toLowerCase(),
        church: c.name,
      };
      const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

      let sentEmail = 0;
      let sentSms = 0;

      if (c.email && r.email) {
        const subject = fill(c.emailSubject);
        const body = fill(c.emailBody);
        try {
          const ok = await sendEmail({
            to: r.email,
            subject,
            html: emailLayout(subject, body.replace(/\n/g, "<br>")),
            text: body,
            fromName: c.name,
          });
          if (ok) sentEmail = 1;
        } catch {
          /* keep going */
        }
      }
      if (c.sms && r.phone) {
        try {
          const res = await sendChurchSms({
            churchId: c.churchId,
            to: r.phone,
            message: fill(c.smsBody),
            reason: "Pledge reminder",
          });
          if (res.ok) sentSms = smsPages(fill(c.smsBody));
        } catch {
          /* keep going */
        }
      }

      if (sentEmail) await recordUsage("email", c.churchId, 1);
      await db
        .update(pledgeReminderRun)
        .set({ sentEmail, sentSms })
        .where(eq(pledgeReminderRun.id, run.id));

      summary.reminders++;
      summary.emails += sentEmail;
      summary.sms += sentSms ? 1 : 0;
    }
  }

  return summary;
}
