import "server-only";
import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
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
import type { RecipientOutcome } from "@/lib/comm-recipients";
import { matchSmsOutcomes, smsRefusalAdvice } from "@/lib/celebration-runs";
import { logReminderToHistory } from "@/lib/reminder-history";
import {
  REMINDER_SMS_MAX_ATTEMPTS,
  RETRY_AFTER_MS,
  SEND_WINDOW_MIN,
  attemptLabel,
  classifyBatchSms,
  historyDetail,
  serviceReminderRetry,
  willRetryAfter,
  type RetryDecision,
  type SmsRunState,
  type SmsVerdict,
} from "@/lib/reminder-retry";

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

type Recipient = {
  id: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  status: string;
};

type SmsJob = { memberId: string; name: string; phone: string; message: string };

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
  /** Failed reminder texts this sweep tried again. */
  smsRetried: number;
  /** Texts those retries got through. */
  smsRetrySent: number;
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

type Decide = (run: SmsRunState, at: Date) => RetryDecision;

/**
 * Send due service reminders. Idempotent: a reminder for a given service
 * occurrence is claimed once (reminder_run unique index). Called every five
 * minutes by the scheduler, so a church's "send at 08:30" is met at 08:30
 * rather than at the next hour; the claim is what makes that safe.
 *
 * Each run row records an outcome per channel. A TEXT that verifiably did not
 * go, for a reason that can clear within the hour (an empty wallet, a sender
 * ID awaiting approval, the gateway turning every number away), is tried again
 * up to twice, an hour apart, while the window is open: before 8pm, not within
 * 30 minutes of the start, and inside the send window. Email is recorded and
 * never retried, so nobody gets the same email twice. Every attempt is in
 * Communication → History with each person's outcome and whether it will be
 * tried again, and a refused batch tells the managers at most once a week.
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
    smsRetried: 0,
    smsRetrySent: 0,
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
   * This occurrence's runs, in one plain query. Only a hint for choosing what
   * to do: every write below repeats the state it relies on in its WHERE, so a
   * row another sweep changed in the meantime is simply not touched.
   */
  const runs = await db
    .select({
      id: reminderRun.id,
      serviceId: reminderRun.serviceId,
      smsOutcome: reminderRun.smsOutcome,
      smsAttempts: reminderRun.smsAttempts,
      smsDetail: reminderRun.smsDetail,
      updatedAt: reminderRun.updatedAt,
    })
    .from(reminderRun)
    .where(
      and(
        eq(reminderRun.churchId, c.churchId),
        eq(reminderRun.serviceDate, serviceDate),
        inArray(
          reminderRun.serviceId,
          services.map((s) => s.id),
        ),
      ),
    );
  const runByService = new Map(runs.map((r) => [r.serviceId, r]));

  /*
   * Recipients, fetched once per church — and only once a service has
   * actually been claimed below. This sweep runs every five minutes for two
   * and a half hours after the church's send time, and most passes find each
   * occurrence already settled; loading the whole membership on each of those
   * would be thirty reads of a thousand rows for nothing.
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
    const base = {
      church: c.name,
      service: svc.name,
      day: DAYS[targetWeekday],
      time: svc.startTime || "",
    };
    const smsJobs = (audience: Recipient[]): SmsJob[] =>
      audience
        .filter((m) => m.phone)
        .map((m) => ({
          memberId: m.id,
          name: m.firstName,
          phone: m.phone as string,
          message: fillTemplate(c.smsTemplate, { ...base, name: m.firstName }),
        }));
    const decide: Decide = (run, at) =>
      serviceReminderRetry({
        run,
        now: at,
        timeZone: tz,
        serviceDate,
        startTime: svc.startTime,
        sendTime: c.sendTime,
        dayBefore: c.dayBefore,
      });

    const existing = runByService.get(svc.id);
    if (existing) {
      // Already claimed: only a failed text can be due anything. Email is
      // never touched on this path.
      if (c.sms)
        await retryServiceSms(c, svc.name, existing, decide, now, summary, async () =>
          smsJobs(await loadAudience()),
        );
      continue;
    }

    // Claim this occurrence, with an outcome per channel it will use.
    const [run] = await db
      .insert(reminderRun)
      .values({
        churchId: c.churchId,
        serviceId: svc.id,
        serviceDate,
        smsOutcome: c.sms ? "pending" : null,
        smsAttempts: c.sms ? 1 : 0,
        emailOutcome: c.email ? "pending" : null,
        emailAttempts: c.email ? 1 : 0,
      })
      .onConflictDoNothing()
      .returning({ id: reminderRun.id });
    // Another worker claimed it between the read and the insert; it is theirs.
    if (!run) continue;
    const audience = await loadAudience();

    summary.services++;
    // The same label the SMS queue gives a held reminder, so History reads
    // the same whichever way it went.
    const label = `Reminder: ${svc.name}`;

    let sentSms = 0;
    let sentEmail = 0;

    // SMS first; its settle starts the retry clock.
    if (c.sms) {
      const jobs = smsJobs(audience);
      if (jobs.length) {
        const r = await sendReminderSms(c, svc.name, label, jobs, now, summary, {
          attempt: 1,
          decide,
        });
        sentSms = r.sent;
        await settleSms(run.id, c.churchId, 1, r.verdict, r.sent, r.willRetry);
      } else {
        await settleSms(
          run.id,
          c.churchId,
          1,
          { outcome: "skipped", detail: "Nobody in this audience has a phone number on file." },
          0,
          false,
        );
      }
    }

    // Email: recorded, never retried.
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
      const firstReason = outcomes.find((o) => o.status === "failed")?.error;
      if (failed > 0) {
        summary.failed += failed;
        // One line per service, not one per member: the per-person reasons
        // are in the History rows.
        console.error(
          `[service-reminders] ${failed} of ${outcomes.length} ${svc.name} reminder email(s) failed for church ${c.churchId}; first reason: ${firstReason}`,
        );
      }
      if (first)
        await logReminderToHistory("service-reminders", c.churchId, "email", label, {
          subject: first.subject,
          body: first.body,
          outcomes,
        });
      await settleEmail(run.id, c.churchId, {
        outcome:
          outcomes.length === 0 ? "skipped" : failed > 0 ? "failed" : "sent",
        detail:
          outcomes.length === 0
            ? "Nobody in this audience has an email address on file."
            : failed > 0
              ? `${failed} of ${outcomes.length} failed; first reason: ${firstReason ?? "none given"}`
              : null,
        sent: sentEmail,
      });
    }

    if (sentEmail > 0) await recordUsage("email", c.churchId, sentEmail);
    summary.sms += sentSms;
    summary.emails += sentEmail;
  }
}

/**
 * The retry claim: one conditional UPDATE on one row, with the whole state it
 * relies on repeated in its WHERE and the returned rows counted.
 *
 * No separate SELECT ... FOR UPDATE is needed because the claim is a single
 * statement. Under READ COMMITTED a second concurrent UPDATE blocks on the
 * row lock, re-evaluates its WHERE against the committed row (now 'pending',
 * attempts n+1), matches nothing and returns no row, so it sends nothing. The
 * unique run index and the CHECK on sms_attempts are the database's half.
 * reminder-retry.db-check.ts proves it with two interleaved transactions.
 *
 * Takes an executor so that check can run it inside a transaction it holds.
 */
export async function claimServiceSmsRetry(
  exec: Pick<typeof db, "update">,
  o: { runId: string; churchId: string; attempts: number; now: Date },
): Promise<boolean> {
  const claimed = await exec
    .update(reminderRun)
    .set({ smsOutcome: "pending", smsAttempts: o.attempts + 1, smsDetail: null })
    .where(
      and(
        eq(reminderRun.id, o.runId),
        eq(reminderRun.churchId, o.churchId),
        eq(reminderRun.smsOutcome, "failed"),
        eq(reminderRun.smsAttempts, o.attempts),
        lt(reminderRun.smsAttempts, REMINDER_SMS_MAX_ATTEMPTS),
        lte(reminderRun.updatedAt, new Date(o.now.getTime() - RETRY_AFTER_MS)),
      ),
    )
    .returning({ id: reminderRun.id });
  return claimed.length === 1;
}

/** Try a failed reminder text again, if the rule says now is the time. */
async function retryServiceSms(
  c: ChurchRow,
  serviceName: string,
  run: SmsRunState & { id: string; smsDetail: string | null },
  decide: Decide,
  now: Date,
  summary: ReminderSummary,
  loadJobs: () => Promise<SmsJob[]>,
): Promise<void> {
  const d = decide(run, now);
  if (d.action === "leave") return;

  if (d.action === "abandon") {
    // A claim older than half an hour belongs to a process that died
    // mid-send. It may have gone, so it is settled, never resent.
    const rows = await db
      .update(reminderRun)
      .set({ smsOutcome: "failed", smsAttempts: REMINDER_SMS_MAX_ATTEMPTS, smsDetail: d.detail })
      .where(
        and(
          eq(reminderRun.id, run.id),
          eq(reminderRun.churchId, c.churchId),
          eq(reminderRun.smsOutcome, "pending"),
          eq(reminderRun.smsAttempts, run.smsAttempts),
        ),
      )
      .returning({ id: reminderRun.id });
    if (rows.length)
      console.warn(
        `[service-reminders] ${serviceName} reminder texts for church ${c.churchId} were interrupted mid-send; settled as failed and not sent again`,
      );
    return;
  }

  if (d.action === "expire") {
    // Nothing is sent. History already has the failed attempt.
    await db
      .update(reminderRun)
      .set({
        smsAttempts: REMINDER_SMS_MAX_ATTEMPTS,
        smsDetail: `${run.smsDetail ?? ""} ${d.detail}`.trim(),
      })
      .where(
        and(
          eq(reminderRun.id, run.id),
          eq(reminderRun.churchId, c.churchId),
          eq(reminderRun.smsOutcome, "failed"),
          eq(reminderRun.smsAttempts, run.smsAttempts),
        ),
      );
    return;
  }

  const attempt = d.attempt;
  const claimed = await claimServiceSmsRetry(db, {
    runId: run.id,
    churchId: c.churchId,
    attempts: run.smsAttempts,
    now,
  });
  // Someone else claimed it, or it changed since it was read.
  if (!claimed) return;

  const jobs = await loadJobs();
  if (jobs.length === 0) {
    await settleSms(
      run.id,
      c.churchId,
      attempt,
      { outcome: "skipped", detail: "Nobody in this audience has a phone number on file." },
      0,
      false,
    );
    return;
  }
  const label = attemptLabel(`Reminder: ${serviceName}`, attempt);
  const r = await sendReminderSms(c, serviceName, label, jobs, now, summary, {
    // Never parked overnight: a held retry could go out after the service.
    timing: "refuse",
    attempt,
    decide,
  });
  await settleSms(run.id, c.churchId, attempt, r.verdict, r.sent, r.willRetry);
  summary.smsRetried++;
  summary.smsRetrySent += r.sent;
}

/**
 * Settle this sweep's own SMS claim. Attempts go to the maximum whenever no
 * retry will follow, so the row is honest about the future. Writes sent_sms
 * here so no later write moves the SMS clock.
 */
async function settleSms(
  runId: string,
  churchId: string,
  attempt: number,
  verdict: SmsVerdict,
  sent: number,
  willRetry: boolean,
): Promise<void> {
  const rows = await db
    .update(reminderRun)
    .set({
      smsOutcome: verdict.outcome,
      smsDetail: verdict.outcome === "failed" ? historyDetail(verdict, willRetry) : verdict.detail,
      smsAttempts:
        verdict.outcome === "failed" && !willRetry ? REMINDER_SMS_MAX_ATTEMPTS : attempt,
      sentSms: sent,
    })
    .where(
      and(
        eq(reminderRun.id, runId),
        eq(reminderRun.churchId, churchId),
        eq(reminderRun.smsOutcome, "pending"),
        eq(reminderRun.smsAttempts, attempt),
      ),
    )
    .returning({ id: reminderRun.id });
  if (rows.length === 0)
    console.error(
      `[service-reminders] run ${runId} for church ${churchId} was no longer this sweep's pending SMS claim (attempt ${attempt}) when it settled as ${verdict.outcome}; the row was left as it was`,
    );
}

/**
 * Record the email half. Keeps updated_at as it was, because here the texts
 * go first and updated_at is the SMS clock: a long email run must not push the
 * next text attempt back and cost it the end of its window.
 */
async function settleEmail(
  runId: string,
  churchId: string,
  o: { outcome: "sent" | "failed" | "skipped"; detail: string | null; sent: number },
): Promise<void> {
  await db
    .update(reminderRun)
    .set({
      emailOutcome: o.outcome,
      emailDetail: o.detail,
      sentEmail: o.sent,
      updatedAt: sql`${reminderRun.updatedAt}`,
    })
    .where(and(eq(reminderRun.id, runId), eq(reminderRun.churchId, churchId)));
}

/**
 * Send one service's SMS reminders and record what became of each. Returns
 * how many the gateway confirmed, the verdict for the run row, and whether a
 * retry will follow (decided now, by the same rule the sweep uses).
 */
async function sendReminderSms(
  c: ChurchRow,
  serviceName: string,
  label: string,
  jobs: SmsJob[],
  now: Date,
  summary: ReminderSummary,
  opts: { timing?: "queue" | "refuse"; attempt: number; decide: Decide },
): Promise<{ sent: number; verdict: SmsVerdict; willRetry: boolean }> {
  const allFailed = (error: string): RecipientOutcome[] =>
    jobs.map((j) => ({
      memberId: j.memberId,
      name: j.name,
      destination: j.phone,
      status: "failed",
      error,
    }));
  const history = (outcomes: RecipientOutcome[], units = 0, cost = 0) =>
    logReminderToHistory("service-reminders", c.churchId, "sms", label, {
      body: jobs[0].message,
      outcomes,
      units,
      cost,
    });
  const judge = (verdict: SmsVerdict) => ({
    verdict,
    willRetry: willRetryAfter(opts.decide, verdict, opts.attempt, new Date()),
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
      timing: opts.timing ?? "queue",
    });
  } catch (e) {
    // Our own code failing around the gateway, which may already have sent
    // some of it. Said so, rather than recorded as nothing having happened.
    const { verdict, willRetry } = judge(classifyBatchSms({ threw: e }));
    summary.failed += jobs.length;
    console.error(
      `[service-reminders] SMS batch for ${serviceName} threw for church ${c.churchId}`,
      e,
    );
    await history(allFailed(historyDetail(verdict, willRetry)));
    return { sent: 0, verdict, willRetry };
  }

  const { verdict, willRetry } = judge(classifyBatchSms(res));

  if (res.ok === "queued") {
    // The queue owns these now and retries on its own. Note: sms-queue.ts
    // writes History only for "communication" and "celebrations", so a queued
    // reminder is recorded on its run row, not in History.
    console.log(
      `[service-reminders] ${res.count} reminder(s) queued for church ${c.churchId} until ${res.sendAfter.toISOString()}`,
    );
    return { sent: 0, verdict, willRetry };
  }

  if (res.ok === false) {
    /*
     * Not enough balance, sender ID not approved, SMS not available: nothing
     * went and nothing was charged. The first two are retried.
     */
    summary.failed += jobs.length;
    console.error(
      `[service-reminders] SMS for ${serviceName} refused for church ${c.churchId} (${jobs.length} reminder(s)): ${res.error}${willRetry ? "; it will be tried again" : ""}`,
    );
    await tellManagersOnceAWeek(
      c,
      serviceName,
      now,
      `${res.error} ${smsRefusalAdvice(res.error, "service reminders")}`,
      willRetry,
    );
    await history(allFailed(historyDetail(verdict, willRetry)));
    return { sent: 0, verdict, willRetry };
  }

  const wholeBatchFailed = verdict.outcome === "failed";
  const { settled, unreported } = matchSmsOutcomes(jobs, res.outcomes);
  // A number that did not go says whether it will be tried again: the whole
  // batch is retried only when none of it went, never one number of many.
  const numberError = (error: string) =>
    historyDetail(
      { outcome: "failed", detail: error, retryable: wholeBatchFailed },
      wholeBatchFailed && willRetry,
    );
  const outcomes: RecipientOutcome[] = settled.map((s) => ({
    memberId: s.job.memberId,
    name: s.job.name,
    destination: s.job.phone,
    status: s.status,
    // A skipped number is unusable and is skipped again on any retry, so only
    // a refused one carries the retry sentence.
    error: s.status === "failed" && s.error ? numberError(s.error) : s.error,
    providerMessageId: s.providerMessageId ?? null,
  }));
  for (const j of unreported)
    outcomes.push({
      memberId: j.memberId,
      name: j.name,
      destination: j.phone,
      status: "failed",
      error: numberError("The gateway did not report on this number."),
    });
  const failed = outcomes.filter((o) => o.status !== "sent").length;
  summary.failed += failed;

  if (wholeBatchFailed) {
    // "ok" from the batch, and yet nothing went: the gateway turned every
    // number away (the platform's float ran out, say). Refunded in full.
    console.error(
      `[service-reminders] the gateway refused every SMS for ${serviceName} at church ${c.churchId}: ${verdict.detail}`,
    );
    await tellManagersOnceAWeek(
      c,
      serviceName,
      now,
      `${verdict.detail} If it happens again, contact FlockInsight support.`,
      willRetry,
    );
  } else if (failed > 0) {
    console.error(
      `[service-reminders] ${failed} of ${jobs.length} ${serviceName} reminder SMS did not go for church ${c.churchId}`,
    );
  }

  await history(outcomes, res.pages, res.cost);
  return { sent: res.sent, verdict, willRetry };
}

/**
 * Tell the church's managers a reminder did not go by SMS, unless they were
 * already told this week. Says whether it will be tried again, decided by the
 * same rule the retry sweep uses, so nobody sends it by hand while a retry is
 * due and texts the whole church twice.
 */
async function tellManagersOnceAWeek(
  c: ChurchRow,
  serviceName: string,
  now: Date,
  reason: string,
  willRetry: boolean,
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
  const next = willRetry
    ? "It will be tried again automatically, an hour from now, before the service and before 8pm. If you fix it before then it goes by itself, so please do not send it again by hand."
    : "It will not be tried again automatically. If it is still needed, send it from Communication once this is fixed.";
  await notifyChurchManagers({
    churchId: c.churchId,
    title,
    body: `The ${serviceName} reminder could not be sent by SMS: ${reason} ${next}`,
    linkUrl: "/settings/reminders",
    email: true,
  });
}
