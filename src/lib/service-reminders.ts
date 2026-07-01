import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, member, reminderRun, reminderSetting, service } from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** Replace {name}, {church}, {service}, {day}, {time} placeholders. */
export function fillTemplate(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

/** Current local date/time in an IANA timezone. */
function nowInTz(tz: string): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wmap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: wmap[get("weekday")] ?? 0,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// How long after the configured time the cron may still fire the reminder
// (so an hourly cron always catches it, but it never sends hours late).
const SEND_WINDOW_MIN = 150;

export type ReminderSummary = {
  churchesChecked: number;
  services: number;
  sms: number;
  emails: number;
};

/**
 * Send due service reminders. Idempotent: a reminder for a given service
 * occurrence is sent at most once (reminder_run unique index). Designed to be
 * called hourly by a cron.
 */
export async function runServiceReminders(): Promise<ReminderSummary> {
  const churches = await db
    .select({
      churchId: reminderSetting.churchId,
      enabled: reminderSetting.enabled,
      sms: reminderSetting.sms,
      email: reminderSetting.email,
      dayBefore: reminderSetting.dayBefore,
      sendTime: reminderSetting.sendTime,
      audience: reminderSetting.audience,
      smsTemplate: reminderSetting.smsTemplate,
      emailSubject: reminderSetting.emailSubject,
      emailTemplate: reminderSetting.emailTemplate,
      name: church.name,
      timezone: church.timezone,
      status: church.status,
    })
    .from(reminderSetting)
    .innerJoin(church, eq(church.id, reminderSetting.churchId))
    .where(and(eq(reminderSetting.enabled, true), eq(church.status, "active")));

  const summary: ReminderSummary = {
    churchesChecked: churches.length,
    services: 0,
    sms: 0,
    emails: 0,
  };

  for (const c of churches) {
    if (!c.sms && !c.email) continue;
    const local = nowInTz(c.timezone || "Africa/Lagos");
    const sendMin = toMinutes(c.sendTime);
    // Only fire inside the send window.
    if (local.minutes < sendMin || local.minutes - sendMin > SEND_WINDOW_MIN)
      continue;

    const targetWeekday = c.dayBefore ? (local.weekday + 1) % 7 : local.weekday;
    const serviceDate = c.dayBefore ? addDays(local.date, 1) : local.date;

    const services = await db
      .select({
        id: service.id,
        name: service.name,
        startTime: service.startTime,
      })
      .from(service)
      .where(
        and(
          eq(service.churchId, c.churchId),
          eq(service.isActive, true),
          eq(service.dayOfWeek, targetWeekday),
        ),
      );
    if (services.length === 0) continue;

    // Recipients (fetched once per church).
    const members = await db
      .select({
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
        status: member.status,
      })
      .from(member)
      .where(eq(member.churchId, c.churchId));
    const audience =
      c.audience === "all"
        ? members
        : members.filter((m) => m.status === "active");

    for (const svc of services) {
      // Claim this occurrence; if it already exists, someone sent it already.
      const [run] = await db
        .insert(reminderRun)
        .values({ churchId: c.churchId, serviceId: svc.id, serviceDate })
        .onConflictDoNothing()
        .returning({ id: reminderRun.id });
      if (!run) continue;

      summary.services++;
      const base = {
        church: c.name,
        service: svc.name,
        day: DAYS[targetWeekday],
        time: svc.startTime || "",
      };

      let sentSms = 0;
      let sentEmail = 0;

      // SMS
      if (c.sms) {
        const recipients = audience
          .filter((m) => m.phone)
          .map((m) => ({
            phone: m.phone as string,
            message: fillTemplate(c.smsTemplate, { ...base, name: m.firstName }),
          }));
        if (recipients.length) {
          const res = await sendChurchSmsBatch({
            churchId: c.churchId,
            recipients,
            label: `Reminder: ${svc.name}`,
          });
          if (res.ok) sentSms = res.sent;
        }
      }

      // Email
      if (c.email) {
        for (const m of audience.filter((x) => x.email)) {
          const vars = { ...base, name: m.firstName };
          const subject = fillTemplate(c.emailSubject, vars);
          const bodyText = fillTemplate(c.emailTemplate, vars);
          try {
            const ok = await sendEmail({
              to: m.email as string,
              subject,
              html: emailLayout(subject, bodyText.replace(/\n/g, "<br>")),
              text: bodyText,
              fromName: c.name,
            });
            if (ok) sentEmail++;
          } catch {
            /* keep going */
          }
        }
      }

      await db
        .update(reminderRun)
        .set({ sentSms, sentEmail })
        .where(eq(reminderRun.id, run.id));
      if (sentEmail > 0) await recordUsage("email", c.churchId, sentEmail);
      summary.sms += sentSms;
      summary.emails += sentEmail;
    }
  }

  return summary;
}
