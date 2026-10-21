import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  communicationLog,
  member,
  reminderRun,
  reminderSetting,
  service,
} from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, plainTextEmailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { inGoodStandingSql } from "@/lib/church-standing";
import { isValidTimeZone } from "@/lib/country-profile";
import { managersToldSince, notifyChurchManagers } from "@/lib/notifications";
import { recordRecipients, tally, type RecipientOutcome } from "@/lib/comm-recipients";
import {
  SMS_BATCH_REFUSED,
  gatewayRefusedEveryNumber,
  matchSmsOutcomes,
  smsRefusalAdvice,
} from "@/lib/celebration-runs";

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const DAY_MS = 86_400_000;

/** Replace {name}, {church}, {service}, {day}, {time} placeholders. */
export function fillTemplate(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

/** Local date/time in an IANA timezone, at `at`. */
function nowInTz(
  tz: string,
  at: Date,
): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);
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
// (so a missed sweep or two is caught up, but it never sends hours late).
const SEND_WINDOW_MIN = 150;

type Recipient = {
  id: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  status: string;
};

export type ReminderSummary = {
  churchesChecked: number;
  services: number;
  sms: number;
  emails: number;
  /** Messages that did not go. Each is in Communication → History with its reason. */
  failed: number;
  /**
   * Churches this sweep could not serve: a stored timezone Intl refuses, or an
   * error part-way through. Logged with the reason, never allowed to stop the
   * churches after it.
   */
  churchesSkipped: number;
};

async function loadChurches(now: Date) {
  return db
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
    .where(
      and(
        eq(reminderSetting.enabled, true),
        eq(church.status, "active"),
        // Not for a church behind the paywall, whose admins can no longer
        // reach the setting that turns this off. See church-standing.ts.
        inGoodStandingSql(now),
      ),
    );
}

type ChurchRow = Awaited<ReturnType<typeof loadChurches>>[number];

/**
 * Send due service reminders. Idempotent: a reminder for a given service
 * occurrence is sent at most once (reminder_run unique index). Called every
 * five minutes by the scheduler, so a church's "send at 08:30" is met at
 * 08:30 rather than at the next hour; the claim is what makes that safe.
 *
 * The claim is written before sending and reminder_run has nowhere to keep an
 * outcome, so a reminder that fails is not retried. What changed is that a
 * failure is no longer silent. A refused SMS batch (no balance, sender ID not
 * approved) used to fall through with no log and sentSms 0, and an email the
 * provider refused went into an empty catch. Now every reminder, sent or not,
 * is in Communication → History with each person's outcome, failures are
 * logged, and a refused SMS batch tells the managers (at most once a week),
 * because only they can top up or chase the sender ID.
 *
 * Each church runs in its own try/catch. A timezone Intl refused, or any
 * error, used to end the sweep for every church after it, on every sweep.
 */
export async function runServiceReminders(
  now: Date = new Date(),
): Promise<ReminderSummary> {
  const churches = await loadChurches(now);

  const summary: ReminderSummary = {
    churchesChecked: churches.length,
    services: 0,
    sms: 0,
    emails: 0,
    failed: 0,
    churchesSkipped: 0,
  };

  for (const c of churches) {
    try {
      await remindChurch(c, now, summary);
    } catch (e) {
      summary.churchesSkipped++;
      console.error(
        `[service-reminders] church ${c.churchId} failed part-way; carrying on with the others`,
        e,
      );
    }
  }

  return summary;
}

async function remindChurch(
  c: ChurchRow,
  now: Date,
  summary: ReminderSummary,
): Promise<void> {
  if (!c.sms && !c.email) return;

  const tz = c.timezone || "Africa/Lagos";
  if (!isValidTimeZone(tz)) {
    // Not guessed: reminding a whole church on the wrong day is worse than a
    // reminder missed and a log line saying exactly why.
    summary.churchesSkipped++;
    console.error(
      `[service-reminders] church ${c.churchId} skipped: its timezone "${tz}" is not one Intl recognises. Fix it in Settings → Church profile.`,
    );
    return;
  }

  const local = nowInTz(tz, now);
  const sendMin = toMinutes(c.sendTime);
  // Only fire inside the send window.
  if (local.minutes < sendMin || local.minutes - sendMin > SEND_WINDOW_MIN)
    return;

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
  if (services.length === 0) return;

  /*
   * Recipients, fetched once per church — and only once a service has
   * actually been claimed below. This sweep runs every five minutes for two
   * and a half hours after the church's send time, and every pass but the
   * first finds each occurrence already claimed; loading the whole
   * membership on each of those would be thirty reads of a thousand rows
   * for nothing.
   */
  let recipients: Recipient[] | null = null;
  const loadAudience = async (): Promise<Recipient[]> => {
    if (recipients) return recipients;
    const members = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
        status: member.status,
      })
      .from(member)
      .where(eq(member.churchId, c.churchId));
    recipients =
      c.audience === "all"
        ? members
        : members.filter((m) => m.status === "active");
    return recipients;
  };

  for (const svc of services) {
    // Claim this occurrence; if it already exists, someone sent it already.
    const [run] = await db
      .insert(reminderRun)
      .values({ churchId: c.churchId, serviceId: svc.id, serviceDate })
      .onConflictDoNothing()
      .returning({ id: reminderRun.id });
    if (!run) continue;
    const audience = await loadAudience();

    summary.services++;
    const base = {
      church: c.name,
      service: svc.name,
      day: DAYS[targetWeekday],
      time: svc.startTime || "",
    };
    // The same label the SMS queue gives a held reminder, so History reads
    // the same whichever way it went.
    const label = `Reminder: ${svc.name}`;

    let sentSms = 0;
    let sentEmail = 0;

    // SMS
    if (c.sms) {
      const jobs = audience
        .filter((m) => m.phone)
        .map((m) => ({
          memberId: m.id,
          name: m.firstName,
          phone: m.phone as string,
          message: fillTemplate(c.smsTemplate, { ...base, name: m.firstName }),
        }));
      if (jobs.length)
        sentSms = await sendReminderSms(c, svc.name, label, jobs, now, summary);
    }

    // Email
    if (c.email) {
      const outcomes: RecipientOutcome[] = [];
      let first: { subject: string; body: string } | null = null;
      for (const m of audience.filter((x) => x.email)) {
        const vars = { ...base, name: m.firstName };
        const subject = fillTemplate(c.emailSubject, vars);
        const bodyText = fillTemplate(c.emailTemplate, vars);
        first ??= { subject, body: bodyText };
        let ok = false;
        let detail: string | null = null;
        try {
          ok = await sendEmail({
            to: m.email as string,
            subject,
            html: plainTextEmailLayout(subject, bodyText),
            text: bodyText,
            fromName: c.name,
          });
          if (!ok) detail = "The mail server did not accept the message.";
        } catch (err) {
          // Recorded, never swallowed: this used to be an empty catch.
          detail = err instanceof Error ? err.message : String(err);
        }
        if (ok) sentEmail++;
        outcomes.push({
          memberId: m.id,
          name: m.firstName,
          destination: m.email,
          status: ok ? "sent" : "failed",
          error: detail,
        });
      }
      const failed = outcomes.length - sentEmail;
      if (failed > 0) {
        summary.failed += failed;
        // One line per service, not one per member: the per-person reasons
        // are in the History rows.
        console.error(
          `[service-reminders] ${failed} of ${outcomes.length} ${svc.name} reminder email(s) failed for church ${c.churchId}; first reason: ${outcomes.find((o) => o.status === "failed")?.error}`,
        );
      }
      if (first)
        await logToHistory(c.churchId, "email", label, {
          subject: first.subject,
          body: first.body,
          outcomes,
        });
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

/**
 * Send one service's SMS reminders and record what became of each. Returns
 * how many the gateway confirmed.
 */
async function sendReminderSms(
  c: ChurchRow,
  serviceName: string,
  label: string,
  jobs: { memberId: string; name: string; phone: string; message: string }[],
  now: Date,
  summary: ReminderSummary,
): Promise<number> {
  const allFailed = (error: string): RecipientOutcome[] =>
    jobs.map((j) => ({
      memberId: j.memberId,
      name: j.name,
      destination: j.phone,
      status: "failed",
      error,
    }));
  const history = (outcomes: RecipientOutcome[], units = 0, cost = 0) =>
    logToHistory(c.churchId, "sms", label, {
      body: jobs[0].message,
      outcomes,
      units,
      cost,
    });

  let res: Awaited<ReturnType<typeof sendChurchSmsBatch>>;
  try {
    res = await sendChurchSmsBatch({
      churchId: c.churchId,
      recipients: jobs.map((j) => ({
        phone: j.phone,
        message: j.message,
        memberId: j.memberId,
        name: j.name,
      })),
      label,
      origin: "service-reminders",
    });
  } catch (e) {
    // Our own code failing around the gateway, which may already have sent
    // some of it. Said so, rather than recorded as nothing having happened.
    const detail = `The SMS send stopped on an internal error, so some may have gone: ${e instanceof Error ? e.message : String(e)}`;
    summary.failed += jobs.length;
    console.error(
      `[service-reminders] SMS batch for ${serviceName} threw for church ${c.churchId}`,
      e,
    );
    await history(allFailed(detail));
    return 0;
  }

  if (res.ok === "queued") {
    // The queue owns these now, and writes the history row when they go.
    console.log(
      `[service-reminders] ${res.count} reminder(s) queued for church ${c.churchId} until ${res.sendAfter.toISOString()}`,
    );
    return 0;
  }

  if (res.ok === false) {
    /*
     * THE BRANCH THAT USED TO BE DROPPED. Not enough balance, sender ID not
     * approved, SMS not available: nothing went and nothing was charged.
     */
    summary.failed += jobs.length;
    console.error(
      `[service-reminders] SMS for ${serviceName} refused for church ${c.churchId} (${jobs.length} reminder(s)): ${res.error}`,
    );
    await tellManagersOnceAWeek(
      c,
      serviceName,
      now,
      `${res.error} ${smsRefusalAdvice(res.error, "service reminders")}`,
    );
    await history(allFailed(`${SMS_BATCH_REFUSED}${res.error}`));
    return 0;
  }

  const { settled, unreported } = matchSmsOutcomes(jobs, res.outcomes);
  const outcomes: RecipientOutcome[] = settled.map((s) => ({
    memberId: s.job.memberId,
    name: s.job.name,
    destination: s.job.phone,
    status: s.status,
    error: s.error,
    providerMessageId: s.providerMessageId ?? null,
  }));
  for (const j of unreported)
    outcomes.push({
      memberId: j.memberId,
      name: j.name,
      destination: j.phone,
      status: "failed",
      error: "The gateway did not report on this number.",
    });
  const failed = outcomes.filter((o) => o.status !== "sent").length;
  summary.failed += failed;

  if (gatewayRefusedEveryNumber(res)) {
    // "ok" from the batch, and yet nothing went: the gateway turned every
    // number away (the platform's float ran out, say). Refunded in full.
    const reason =
      res.outcomes.find((o) => o.status === "failed")?.error ?? "no reason was given";
    console.error(
      `[service-reminders] the gateway refused every SMS for ${serviceName} at church ${c.churchId}: ${reason}`,
    );
    await tellManagersOnceAWeek(
      c,
      serviceName,
      now,
      `The SMS gateway turned every message away (${reason}), so nothing was charged. If it happens again, contact FlockInsight support.`,
    );
  } else if (failed > 0) {
    console.error(
      `[service-reminders] ${failed} of ${jobs.length} ${serviceName} reminder SMS did not go for church ${c.churchId}`,
    );
  }

  await history(outcomes, res.pages, res.cost);
  return res.sent;
}

/**
 * Tell the church's managers a reminder did not go by SMS, unless they were
 * already told this week. Reminders are not retried (see runServiceReminders),
 * so the notice says so.
 */
async function tellManagersOnceAWeek(
  c: ChurchRow,
  serviceName: string,
  now: Date,
  reason: string,
): Promise<void> {
  const title = `${c.name}: service reminder texts were not sent`;
  if (
    await managersToldSince({
      churchId: c.churchId,
      title,
      since: new Date(now.getTime() - 7 * DAY_MS),
    })
  )
    return;
  await notifyChurchManagers({
    churchId: c.churchId,
    title,
    body: `The ${serviceName} reminder could not be sent by SMS: ${reason} It will not be tried again automatically. If it is still needed, send it from Communication once this is fixed.`,
    linkUrl: "/settings/reminders",
    email: true,
  });
}

/**
 * Put an automatic reminder in Communication → History, beside what the
 * church sent by hand. It used to be recorded only in reminder_run, which no
 * page reads, so a reminder that failed could not be seen to have failed and
 * one that went could not be seen to have gone.
 *
 * Best-effort: failing to write the history must never undo or repeat a
 * reminder that already went.
 */
async function logToHistory(
  churchId: string,
  channel: "sms" | "email",
  audience: string,
  o: {
    subject?: string;
    body: string;
    outcomes: RecipientOutcome[];
    units?: number;
    cost?: number;
  },
): Promise<void> {
  if (o.outcomes.length === 0) return;
  try {
    const counts = tally(o.outcomes);
    const [log] = await db
      .insert(communicationLog)
      .values({
        churchId,
        channel,
        audience,
        subject: o.subject ?? null,
        // The first person's message stands for the batch, as the queue does;
        // each recipient got their own name in it.
        body: o.body,
        recipients: counts.recipients,
        sent: counts.sent,
        failed: counts.failed,
        skipped: counts.skipped,
        units: o.units ?? 0,
        cost: o.cost ?? 0,
      })
      .returning({ id: communicationLog.id });
    if (log) await recordRecipients(log.id, churchId, o.outcomes);
  } catch (e) {
    console.error(
      `[service-reminders] reminder could not be written to the history for church ${churchId}:`,
      e,
    );
  }
}
