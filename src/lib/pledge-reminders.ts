import "server-only";
import { and, eq, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
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
import { outstandingOn } from "@/lib/pledge-status";
import type { PledgeCadence } from "@/lib/projects-shared";
import { sendChurchSms, type ChurchSmsResult } from "@/lib/church-sms";
import { sendEmail, plainTextEmailLayout } from "@/lib/mailer";
import { smsPages } from "@/lib/sms";
import { recordUsage } from "@/lib/usage";
import { formatMoney } from "@/lib/money";
import { inGoodStandingSql } from "@/lib/church-standing";
import { managersToldSince, notifyChurchManagers } from "@/lib/notifications";
import { churchCanClearSmsRefusal, smsRefusalAdvice } from "@/lib/celebration-runs";
import type { RecipientOutcome } from "@/lib/comm-recipients";
import { logReminderToHistory } from "@/lib/reminder-history";
import {
  REMINDER_SMS_MAX_ATTEMPTS,
  RETRY_AFTER_MS,
  attemptLabel,
  classifySingleSms,
  historyDetail,
  pledgeReminderRetry,
  willRetryAfter,
  type RetryDecision,
  type SmsRunState,
  type SmsVerdict,
} from "@/lib/reminder-retry";

/* ============================================================
 * Pledge installment reminders — nudge members with an outstanding pledge once
 * per cadence period, until it's paid off. Idempotent per pledge per period
 * (pledge_reminder_run unique index). Bundled into the daily reminders cron;
 * failed texts are retried from the five-minute service-reminders route.
 * ========================================================== */

export type PledgeReminderSummary = {
  churchesChecked: number;
  reminders: number;
  emails: number;
  sms: number;
  /** Messages that did not go. Each is logged with its church, pledge and reason. */
  failed: number;
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


type PledgeVars = {
  firstName: string | null;
  projectName: string;
  amount: number;
  paid: number;
  outstanding: number;
  cadence: PledgeCadence;
  cadenceLabel: string | null;
  churchName: string;
  currency: string;
};

/** Fill a pledge template with this member's figures as they stand now. */
function fillPledge(tpl: string, v: PledgeVars): string {
  const vars: Record<string, string> = {
    name: v.firstName || "friend",
    project: v.projectName,
    amount: formatMoney(v.amount, v.currency),
    paid: formatMoney(v.paid, v.currency),
    outstanding: formatMoney(v.outstanding, v.currency),
    cadence: cadenceLabel(v.cadence, v.cadenceLabel).toLowerCase(),
    church: v.churchName,
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** The pledge retry rule with this church's timezone and this row's claim. */
const pledgeDecider =
  (timeZone: string, claimedAt: Date | string) =>
  (run: SmsRunState, at: Date): RetryDecision =>
    pledgeReminderRetry({ run, now: at, timeZone, claimedAt });

/**
 * Settle this sweep's own SMS claim on a pledge run. Attempts go to the
 * maximum when no retry will follow, so the row is honest about the future.
 */
async function settlePledgeSms(
  runId: string,
  churchId: string,
  attempt: number,
  verdict: SmsVerdict,
  sentSms: number,
  willRetry: boolean,
): Promise<void> {
  const rows = await db
    .update(pledgeReminderRun)
    .set({
      smsOutcome: verdict.outcome,
      smsDetail: verdict.outcome === "failed" ? historyDetail(verdict, willRetry) : verdict.detail,
      smsAttempts:
        verdict.outcome === "failed" && !willRetry ? REMINDER_SMS_MAX_ATTEMPTS : attempt,
      sentSms,
    })
    .where(
      and(
        eq(pledgeReminderRun.id, runId),
        eq(pledgeReminderRun.churchId, churchId),
        eq(pledgeReminderRun.smsOutcome, "pending"),
        eq(pledgeReminderRun.smsAttempts, attempt),
      ),
    )
    .returning({ id: pledgeReminderRun.id });
  if (rows.length === 0)
    console.error(
      `[pledge-reminders] run ${runId} for church ${churchId} was no longer this sweep's pending SMS claim (attempt ${attempt}) when it settled as ${verdict.outcome}; the row was left as it was`,
    );
}

/**
 * The History outcome for one pledge text, or null when it has none. A queued
 * text is left out: the queue writes History only for "communication" and
 * "celebrations", so it has no status here it could honestly carry. An
 * unconfirmed one is "sent" with its warning, as the batch sender records
 * them, because "failed" would invite somebody to send it again.
 */
function smsHistoryOutcome(
  r: { memberId: string; firstName: string | null; phone: string },
  res: { threw: unknown } | ChurchSmsResult,
  verdict: SmsVerdict,
  willRetry: boolean,
): RecipientOutcome | null {
  if (verdict.outcome === "queued" || verdict.outcome === "skipped") return null;
  const who = { memberId: r.memberId, name: r.firstName, destination: r.phone };
  if (verdict.outcome === "sent") return { ...who, status: "sent", error: null };
  if (!("threw" in res) && res.ok === false && res.uncertain)
    return { ...who, status: "sent", error: res.error };
  return { ...who, status: "failed", error: historyDetail(verdict, willRetry) };
}

/**
 * Nudge members with an outstanding pledge once per cadence period. Each run
 * row now records an outcome per channel. The email is sent and settled
 * first, then the text; a text refused for a reason that can clear within the
 * hour (an empty wallet, a sender ID awaiting approval, a gateway that could
 * not be reached or refused it outright) is tried again up to twice the same
 * day, an hour apart, before 8pm, by retryPledgeReminderSms. The email is
 * never retried. Every attempt goes to Communication → History, and a refusal
 * only the church can clear tells its managers, at most once a week.
 */
export async function runPledgeReminders(
  now: Date = new Date(),
): Promise<PledgeReminderSummary> {
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
      and(
        eq(pledgeReminderSetting.enabled, true),
        eq(church.status, "active"),
        // Not for a church behind the paywall, whose admins can no longer
        // reach the setting that turns this off. See church-standing.ts.
        inGoodStandingSql(now),
      ),
    );

  const summary: PledgeReminderSummary = {
    churchesChecked: churches.length,
    reminders: 0,
    emails: 0,
    sms: 0,
    failed: 0,
  };

  for (const c of churches) {
    if (!c.email && !c.sms) continue;
    const tz = c.timezone || "Africa/Lagos";
    const today = localDate(tz);

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
        memberId: member.id,
        firstName: member.firstName,
        phone: member.phone,
        email: member.email,
      })
      .from(pledge)
      // Both joins pin church_id, as the retry query does, so one church's
      // pledge can never pair with another church's project or member.
      .innerJoin(
        project,
        and(
          eq(project.id, pledge.projectId),
          eq(project.churchId, pledge.churchId),
          eq(project.status, "active"),
        ),
      )
      .innerJoin(
        member,
        and(eq(member.id, pledge.memberId), eq(member.churchId, pledge.churchId)),
      )
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

    // The first refusal this church's managers can clear themselves (an empty
    // wallet, a sender ID awaiting approval), how many texts it stopped, and
    // whether any of those still has a retry ahead.
    let refusal: string | null = null;
    let refused = 0;
    let refusedWillRetry = false;

    // What History is told, per channel, once this church is done.
    const smsOutcomes: RecipientOutcome[] = [];
    const emailOutcomes: RecipientOutcome[] = [];
    let smsUnits = 0;
    let smsCost = 0;

    for (const r of rows) {
      const useEmail = !!(c.email && r.email);
      const useSms = !!(c.sms && r.phone);
      if (!useEmail && !useSms) continue;

      const amount = Number(r.amount);
      const paidAmt = paid.get(r.id) ?? 0;
      // Settled means settled: a pledge left a fraction of a kobo short by
      // float drift must not keep texting someone who has finished paying.
      const outstanding = outstandingOn(amount, paidAmt);
      if (outstanding <= 0) continue;

      const start = r.startDate || r.createdAt.toISOString().slice(0, 10);
      const idx = periodIndex(r.cadence, start, today);
      if (idx < 1) continue; // still in the first period — don't nag yet

      const periodKey = `${r.cadence}:${idx}`;

      // Claim this period, with an outcome per channel it will use; if it
      // exists, we've already reminded for it.
      const [run] = await db
        .insert(pledgeReminderRun)
        .values({
          churchId: c.churchId,
          pledgeId: r.id,
          periodKey,
          smsOutcome: useSms ? "pending" : null,
          smsAttempts: useSms ? 1 : 0,
          emailOutcome: useEmail ? "pending" : null,
          emailAttempts: useEmail ? 1 : 0,
        })
        .onConflictDoNothing()
        .returning({ id: pledgeReminderRun.id, createdAt: pledgeReminderRun.createdAt });
      if (!run) continue;

      const vars: PledgeVars = {
        firstName: r.firstName,
        projectName: r.projectName,
        amount,
        paid: paidAmt,
        outstanding,
        cadence: r.cadence,
        cadenceLabel: r.cadenceLabel,
        churchName: c.name,
        currency: c.currency,
      };

      let sentEmail = 0;
      let sentSms = 0;

      // Email first, and settled before the text is: on this table no email
      // write ever lands after an SMS one, so updated_at stays the SMS clock.
      if (useEmail) {
        const subject = fillPledge(c.emailSubject, vars);
        const body = fillPledge(c.emailBody, vars);
        let detail: string | null = null;
        try {
          const ok = await sendEmail({
            to: r.email as string,
            subject,
            html: plainTextEmailLayout(subject, body),
            text: body,
            fromName: c.name,
          });
          if (ok) sentEmail = 1;
          else detail = "The mail server did not accept the message.";
        } catch (e) {
          // Recorded, never swallowed: this used to be an empty catch.
          detail = e instanceof Error ? e.message : String(e);
        }
        if (detail) {
          summary.failed++;
          console.error(
            `[pledge-reminders] email for pledge ${r.id} failed for church ${c.churchId}: ${detail}`,
          );
        }
        emailOutcomes.push({
          memberId: r.memberId,
          name: r.firstName,
          destination: r.email,
          status: detail ? "failed" : "sent",
          error: detail,
        });
        await db
          .update(pledgeReminderRun)
          .set({ emailOutcome: detail ? "failed" : "sent", emailDetail: detail, sentEmail })
          .where(
            and(eq(pledgeReminderRun.id, run.id), eq(pledgeReminderRun.churchId, c.churchId)),
          );
      }

      if (useSms) {
        const phone = r.phone as string;
        const message = fillPledge(c.smsBody, vars);
        let res: { threw: unknown } | ChurchSmsResult;
        try {
          res = await sendChurchSms({
            churchId: c.churchId,
            to: phone,
            message,
            reason: "Pledge reminder",
            origin: "pledge-reminders",
          });
        } catch (e) {
          res = { threw: e };
          console.error(
            `[pledge-reminders] SMS for pledge ${r.id} threw for church ${c.churchId}; it may have gone`,
            e,
          );
        }
        const verdict = classifySingleSms(res);
        const willRetry = willRetryAfter(
          pledgeDecider(tz, run.createdAt),
          verdict,
          1,
          new Date(),
        );
        // Only a real send counts against the run. A queued one is recorded
        // in the queue, and counting it twice would overstate what went out.
        if (!("threw" in res) && res.ok === true) {
          sentSms = smsPages(message);
          smsUnits += sentSms;
          smsCost += res.cost;
        } else if (!("threw" in res) && res.ok === false) {
          if (res.uncertain) {
            // Kept charged and never resent: it may well have gone.
            console.error(
              `[pledge-reminders] SMS for pledge ${r.id} at church ${c.churchId} was not confirmed by the gateway, so it may have gone: ${res.error}`,
            );
          } else {
            summary.failed++;
            console.error(
              `[pledge-reminders] SMS for pledge ${r.id} not sent for church ${c.churchId}: ${res.error}${willRetry ? "; it will be tried again" : ""}`,
            );
            if (churchCanClearSmsRefusal(res.error)) {
              refusal ??= res.error;
              refused++;
              refusedWillRetry ||= willRetry;
            }
          }
        } else if ("threw" in res) {
          summary.failed++;
        }
        await settlePledgeSms(run.id, c.churchId, 1, verdict, sentSms, willRetry);
        const outcome = smsHistoryOutcome(
          { memberId: r.memberId, firstName: r.firstName, phone },
          res,
          verdict,
          willRetry,
        );
        if (outcome) smsOutcomes.push(outcome);
      }

      if (sentEmail) await recordUsage("email", c.churchId, 1);

      summary.reminders++;
      summary.emails += sentEmail;
      summary.sms += sentSms ? 1 : 0;
    }

    /*
     * One History row per channel for the church. The body is the church's
     * template with its placeholders unfilled: a filled one would show one
     * member's pledge, paid figure and balance to anybody who can read
     * History, and pledges sit behind giving permissions.
     */
    await logReminderToHistory("pledge-reminders", c.churchId, "sms", "Pledge reminders", {
      body: c.smsBody,
      outcomes: smsOutcomes,
      units: smsUnits,
      cost: smsCost,
    });
    await logReminderToHistory("pledge-reminders", c.churchId, "email", "Pledge reminders", {
      subject: c.emailSubject,
      body: c.emailBody,
      outcomes: emailOutcomes,
    });

    if (refusal) await tellManagersOnceAWeek(c, now, refused, refusal, refusedWillRetry);
  }

  return summary;
}

export type PledgeSmsRetrySummary = {
  /** Texts tried again this pass. */
  retried: number;
  sent: number;
  failed: number;
  /** Rows closed without sending: out of window, interrupted, or no longer due. */
  expired: number;
};

/**
 * Try again the pledge texts that failed earlier today. Called every five
 * minutes from the service-reminders cron route, because a retry is due an
 * hour after the failure and the daily reminders job runs once a day.
 *
 * Re-applies exactly the first attempt's filters (an enabled setting with SMS
 * on, an active church in good standing, an active pledge on an active
 * project), so it never reaches a church the first attempt would have skipped.
 * Every join pins church_id, so one church's pledge never pairs with another
 * church's member.
 */
export async function retryPledgeReminderSms(
  now: Date = new Date(),
): Promise<PledgeSmsRetrySummary> {
  const summary: PledgeSmsRetrySummary = { retried: 0, sent: 0, failed: 0, expired: 0 };
  const rows = await loadPledgeRetryRows(now);
  if (rows.length === 0) return summary;

  const byChurch = new Map<string, RetryRow[]>();
  for (const r of rows) byChurch.set(r.churchId, [...(byChurch.get(r.churchId) ?? []), r]);

  for (const [churchId, churchRows] of byChurch) {
    try {
      await retryChurchPledgeSms(churchId, churchRows, now, summary);
    } catch (e) {
      console.error(
        `[pledge-reminders] SMS retries for church ${churchId} failed part-way; carrying on with the others`,
        e,
      );
    }
  }
  return summary;
}

/**
 * How far back the retry sweep looks. A retry only ever happens on the local
 * day of the first attempt; 26 hours covers any timezone without reading old
 * rows.
 */
const RETRY_LOOKBACK_MS = 26 * 60 * 60_000;

/** Failed or stale-pending pledge texts from the last day, with what a retry needs. */
async function loadPledgeRetryRows(now: Date) {
  return db
    .select({
      runId: pledgeReminderRun.id,
      churchId: pledgeReminderRun.churchId,
      pledgeId: pledgeReminderRun.pledgeId,
      smsAttempts: pledgeReminderRun.smsAttempts,
      smsOutcome: pledgeReminderRun.smsOutcome,
      smsDetail: pledgeReminderRun.smsDetail,
      updatedAt: pledgeReminderRun.updatedAt,
      createdAt: pledgeReminderRun.createdAt,
      amount: pledge.amount,
      cadence: pledge.cadence,
      cadenceLabel: pledge.cadenceLabel,
      projectName: project.name,
      memberId: member.id,
      firstName: member.firstName,
      phone: member.phone,
      smsBody: pledgeReminderSetting.smsBody,
      churchName: church.name,
      timezone: church.timezone,
      currency: church.currency,
    })
    .from(pledgeReminderRun)
    .innerJoin(
      pledge,
      and(
        eq(pledge.id, pledgeReminderRun.pledgeId),
        eq(pledge.churchId, pledgeReminderRun.churchId),
        eq(pledge.status, "active"),
      ),
    )
    .innerJoin(
      project,
      and(
        eq(project.id, pledge.projectId),
        eq(project.churchId, pledge.churchId),
        eq(project.status, "active"),
      ),
    )
    .innerJoin(
      member,
      and(eq(member.id, pledge.memberId), eq(member.churchId, pledge.churchId)),
    )
    .innerJoin(
      pledgeReminderSetting,
      and(
        eq(pledgeReminderSetting.churchId, pledgeReminderRun.churchId),
        eq(pledgeReminderSetting.enabled, true),
        eq(pledgeReminderSetting.sms, true),
      ),
    )
    .innerJoin(
      church,
      and(eq(church.id, pledgeReminderRun.churchId), eq(church.status, "active")),
    )
    .where(
      and(
        // Served by pledge_reminder_run_sms_retry_idx. 'pending' is read too,
        // so a claim left by a process that died mid-send is settled.
        inArray(pledgeReminderRun.smsOutcome, ["failed", "pending"]),
        lt(pledgeReminderRun.smsAttempts, REMINDER_SMS_MAX_ATTEMPTS),
        gte(pledgeReminderRun.createdAt, new Date(now.getTime() - RETRY_LOOKBACK_MS)),
        // Joined query, so drizzle qualifies these columns; see church-standing.ts.
        inGoodStandingSql(now),
      ),
    );
}

type RetryRow = Awaited<ReturnType<typeof loadPledgeRetryRows>>[number];

async function retryChurchPledgeSms(
  churchId: string,
  rows: RetryRow[],
  now: Date,
  summary: PledgeSmsRetrySummary,
): Promise<void> {
  // Re-read what has been paid, so a retry never quotes yesterday's balance.
  const paid = await paidByPledge(
    churchId,
    rows.map((r) => r.pledgeId),
  );
  // One History row per attempt number, as each is its own send.
  const history = new Map<number, { outcomes: RecipientOutcome[]; units: number; cost: number }>();
  const template = rows[0].smsBody;

  /** Close a failed row without sending. Conditional on the state read. */
  const closeFailed = async (
    r: RetryRow,
    set: { smsOutcome?: "skipped"; smsDetail: string },
  ) => {
    const done = await db
      .update(pledgeReminderRun)
      .set({ ...set, smsAttempts: REMINDER_SMS_MAX_ATTEMPTS })
      .where(
        and(
          eq(pledgeReminderRun.id, r.runId),
          eq(pledgeReminderRun.churchId, churchId),
          eq(pledgeReminderRun.smsOutcome, "failed"),
          eq(pledgeReminderRun.smsAttempts, r.smsAttempts),
        ),
      )
      .returning({ id: pledgeReminderRun.id });
    if (done.length) summary.expired++;
  };

  for (const r of rows) {
    const tz = r.timezone || "Africa/Lagos";
    const decide = pledgeDecider(tz, r.createdAt);
    const d = decide(r, now);
    if (d.action === "leave") continue;

    if (d.action === "abandon") {
      // A dead process's claim. It may have gone, so it is settled, never resent.
      const done = await db
        .update(pledgeReminderRun)
        .set({ smsOutcome: "failed", smsAttempts: REMINDER_SMS_MAX_ATTEMPTS, smsDetail: d.detail })
        .where(
          and(
            eq(pledgeReminderRun.id, r.runId),
            eq(pledgeReminderRun.churchId, churchId),
            eq(pledgeReminderRun.smsOutcome, "pending"),
            eq(pledgeReminderRun.smsAttempts, r.smsAttempts),
          ),
        )
        .returning({ id: pledgeReminderRun.id });
      if (done.length) {
        summary.expired++;
        console.warn(
          `[pledge-reminders] pledge text ${r.runId} for church ${churchId} was interrupted mid-send; settled as failed and not sent again`,
        );
      }
      continue;
    }

    if (d.action === "expire") {
      await closeFailed(r, { smsDetail: `${r.smsDetail ?? ""} ${d.detail}`.trim() });
      continue;
    }

    const amount = Number(r.amount);
    const paidAmt = paid.get(r.pledgeId) ?? 0;
    const outstanding = outstandingOn(amount, paidAmt);
    if (outstanding <= 0) {
      // Neutral wording: History readers need not learn it was paid off.
      await closeFailed(r, {
        smsOutcome: "skipped",
        smsDetail: "No longer due when it was retried; not sent.",
      });
      continue;
    }
    if (!r.phone) {
      await closeFailed(r, {
        smsOutcome: "skipped",
        smsDetail: "No phone number on file when it was retried; not sent.",
      });
      continue;
    }

    // THE CLAIM: one conditional UPDATE with the whole state repeated and the
    // returned row counted. See claimServiceSmsRetry in service-reminders.ts.
    const claimed = await db
      .update(pledgeReminderRun)
      .set({ smsOutcome: "pending", smsAttempts: d.attempt, smsDetail: null })
      .where(
        and(
          eq(pledgeReminderRun.id, r.runId),
          eq(pledgeReminderRun.churchId, churchId),
          eq(pledgeReminderRun.smsOutcome, "failed"),
          eq(pledgeReminderRun.smsAttempts, r.smsAttempts),
          lt(pledgeReminderRun.smsAttempts, REMINDER_SMS_MAX_ATTEMPTS),
          lte(pledgeReminderRun.updatedAt, new Date(now.getTime() - RETRY_AFTER_MS)),
        ),
      )
      .returning({ id: pledgeReminderRun.id });
    if (claimed.length !== 1) continue;

    const message = fillPledge(r.smsBody, {
      firstName: r.firstName,
      projectName: r.projectName,
      amount,
      paid: paidAmt,
      outstanding,
      cadence: r.cadence,
      cadenceLabel: r.cadenceLabel,
      churchName: r.churchName,
      currency: r.currency,
    });
    let res: { threw: unknown } | ChurchSmsResult;
    try {
      res = await sendChurchSms({
        churchId,
        to: r.phone,
        message,
        // Never parked overnight: the rule already needs the window open.
        timing: "refuse",
        reason: "Pledge reminder",
        origin: "pledge-reminders",
      });
    } catch (e) {
      res = { threw: e };
      console.error(
        `[pledge-reminders] retried SMS for pledge ${r.pledgeId} threw for church ${churchId}; it may have gone`,
        e,
      );
    }
    const verdict = classifySingleSms(res);
    const willRetry = willRetryAfter(decide, verdict, d.attempt, new Date());
    const ok = !("threw" in res) && res.ok === true;
    const sentSms = ok ? smsPages(message) : 0;
    await settlePledgeSms(r.runId, churchId, d.attempt, verdict, sentSms, willRetry);
    summary.retried++;
    if (ok) summary.sent++;
    else {
      summary.failed++;
      console.error(
        `[pledge-reminders] retried SMS for pledge ${r.pledgeId} (attempt ${d.attempt}) not sent for church ${churchId}: ${verdict.detail}${willRetry ? "; it will be tried again" : ""}`,
      );
    }

    const slot = history.get(d.attempt) ?? { outcomes: [], units: 0, cost: 0 };
    const outcome = smsHistoryOutcome(
      { memberId: r.memberId, firstName: r.firstName, phone: r.phone },
      res,
      verdict,
      willRetry,
    );
    if (outcome) slot.outcomes.push(outcome);
    if (ok && !("threw" in res) && res.ok === true) {
      slot.units += sentSms;
      slot.cost += res.cost;
    }
    history.set(d.attempt, slot);
  }

  // Managers are not told again: the first attempt's notice already said
  // what would happen.
  for (const [attempt, slot] of history)
    await logReminderToHistory(
      "pledge-reminders",
      churchId,
      "sms",
      attemptLabel("Pledge reminders", attempt),
      { body: template, outcomes: slot.outcomes, units: slot.units, cost: slot.cost },
    );
}

/**
 * Tell the church's managers their pledge texts were refused, unless they were
 * already told this week. A church that has decided not to top up hears about
 * it weekly, not every morning. Says whether the texts will be tried again,
 * so nobody sends them by hand while a retry is due.
 */
async function tellManagersOnceAWeek(
  c: { churchId: string; name: string },
  now: Date,
  count: number,
  reason: string,
  willRetry: boolean,
): Promise<void> {
  const title = `${c.name}: pledge reminder texts were not sent`;
  if (
    await managersToldSince({
      churchId: c.churchId,
      title,
      since: new Date(now.getTime() - 7 * 86_400_000),
    })
  )
    return;
  const next = willRetry
    ? "Each will be tried again up to twice more today, an hour apart, before 8pm; after that it waits for that pledge's next period."
    : "A reminder that did not go waits for that pledge's next period.";
  await notifyChurchManagers({
    churchId: c.churchId,
    title,
    body: `${count} pledge reminder${count === 1 ? "" : "s"} could not be sent by SMS today: ${reason} ${smsRefusalAdvice(reason, "pledge reminders")} ${next}`,
    linkUrl: "/settings/giving",
    email: true,
  });
}
