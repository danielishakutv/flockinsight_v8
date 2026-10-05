import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, member, firstTimerSetting, firstTimerRun } from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { fillTemplate } from "@/lib/service-reminders";
import { ensureSignup, signupUrl } from "@/lib/member-signup";
import { localMinutesOfDay, minutesFromHHMM } from "@/lib/sms-window";

export type FirstTimerSummary = {
  churchesChecked: number;
  /** Enabled, but their own send time has not come round yet where they are. */
  churchesWaiting: number;
  welcome: number;
  invites: number;
  emails: number;
  sms: number;
  /** Handed to the 8am–8pm queue rather than sent now. */
  queued: number;
  /** Did not go out, and the reason is on the run row. */
  failed: number;
};

const DAY_MS = 86_400_000;

/**
 * How many times one message may be attempted before it is left alone.
 *
 * A first-timer send fails for reasons a church fixes — no wallet balance, a
 * sender ID still awaiting approval — so it must be retried rather than
 * written off. But a church that never fixes it must not be retried for ever,
 * or every sweep would try the whole visitor history again.
 */
const MAX_ATTEMPTS = 3;

type Channel = "sms" | "email";
type Stage = "welcome" | "invite";

/** One message this sweep intends to send, and the run row that tracks it. */
type Job = {
  runId: string;
  memberId: string;
  stage: Stage;
  channel: Channel;
  phone: string | null;
  email: string | null;
  name: string;
  /** The SMS text, already filled in. */
  message: string;
  subject: string;
  body: string;
};

/**
 * The first-timer nurture sequence: a welcome a day or so after someone is
 * registered as a visitor, then a "become a member" invite a fortnight later.
 *
 * THREE THINGS THIS GOT WRONG, AND WHY THE CODE NOW LOOKS LIKE THIS.
 *
 * It wrote the run row BEFORE sending. The row existed to stop a second cron
 * run sending twice, which it did — and it also marked a send that then failed
 * as permanently done. Every visitor whose text did not go out was never tried
 * again, and nothing recorded that it had not gone. The row is now written as
 * `pending`, updated with what actually happened, and a failure is retried.
 *
 * It ignored `ok: false` from the SMS batch. Sender ID not approved, empty
 * wallet, a country SMS is not sold in — all three returned quietly and the
 * sweep reported success. Every branch is now recorded, and the failure is
 * logged, because its causes are things only an operator or the church clears.
 *
 * It never read `firstTimerSetting.sendTime`. A church setting "send at 10:00"
 * changed nothing: the sweep sent whenever the cron fired, which on a UTC box
 * is the small hours in Lagos — outside the 8am–8pm window SMS may be
 * delivered in, so the whole batch went to the queue instead of going out.
 * The setting is now the gate, which is also what keeps sends inside the
 * window. That means THIS JOB MUST RUN HOURLY, not daily: a daily sweep at a
 * fixed UTC hour would miss every church whose local send time falls at any
 * other hour. See CRON_JOBS in lib/cron-schedule.ts.
 *
 * Still idempotent per member per stage per channel, so an hourly sweep is
 * cheap and running it twice is a no-op.
 */
export async function runFirstTimers(
  now: Date = new Date(),
): Promise<FirstTimerSummary> {
  const churches = await db
    .select({
      churchId: firstTimerSetting.churchId,
      sms: firstTimerSetting.sms,
      email: firstTimerSetting.email,
      sendTime: firstTimerSetting.sendTime,
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
      timezone: church.timezone,
    })
    .from(firstTimerSetting)
    .innerJoin(church, eq(church.id, firstTimerSetting.churchId))
    .where(and(eq(firstTimerSetting.enabled, true), eq(church.status, "active")));

  const summary: FirstTimerSummary = {
    churchesChecked: churches.length,
    churchesWaiting: 0,
    welcome: 0,
    invites: 0,
    emails: 0,
    sms: 0,
    queued: 0,
    failed: 0,
  };

  for (const c of churches) {
    if (!c.sms && !c.email) continue;

    /*
     * Has this church's own send time come round yet, where this church is?
     *
     * At or after, not "within the hour": the sweep runs hourly and a missed
     * tick must not push a visitor's welcome to tomorrow. Later ticks the same
     * day find the row already claimed, so there is no second send.
     */
    if (localMinutesOfDay(now, c.timezone) < minutesFromHHMM(c.sendTime)) {
      summary.churchesWaiting++;
      continue;
    }

    // The self-registration link used in the "become a member" invite.
    const signup = await ensureSignup({
      id: c.churchId,
      name: c.name,
      handle: c.handle,
    });
    const link = signupUrl(signup.slug);

    // Only look at recent first-timers, so enabling the feature never blasts a
    // church's whole visitor history at once.
    const cutoff = new Date(now.getTime() - (c.inviteDelayDays + 30) * DAY_MS);

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

    if (members.length === 0) continue;

    /*
     * Every run row for these people, read in one query rather than one per
     * member per stage — a church with 2,000 recent visitors would otherwise
     * cost thousands of round trips before a single message was sent.
     */
    const runRows = await db
      .select({
        id: firstTimerRun.id,
        memberId: firstTimerRun.memberId,
        stage: firstTimerRun.stage,
        channel: firstTimerRun.channel,
        outcome: firstTimerRun.outcome,
        attempts: firstTimerRun.attempts,
      })
      .from(firstTimerRun)
      .where(
        and(
          eq(firstTimerRun.churchId, c.churchId),
          inArray(
            firstTimerRun.memberId,
            members.map((m) => m.id),
          ),
        ),
      );

    const byKey = new Map(
      runRows.map((r) => [`${r.memberId}|${r.stage}|${r.channel}`, r]),
    );

    const jobs: Job[] = [];
    const stagesClaimed = new Set<string>();

    for (const m of members) {
      const ageDays = Math.floor(
        (now.getTime() - new Date(m.createdAt).getTime()) / DAY_MS,
      );
      const vars = { name: m.firstName, church: c.name, link };

      const stages: {
        stage: Stage;
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

        /*
         * A row written before this table had channels covers both of them.
         * Those people were contacted — treat the stage as finished rather
         * than send a second "thank you for visiting" weeks later.
         */
        if (byKey.has(`${m.id}|${s.stage}|all`)) continue;

        const wanted: Channel[] = [];
        if (c.sms && m.phone) wanted.push("sms");
        if (c.email && m.email) wanted.push("email");

        for (const channel of wanted) {
          const runId = await claimRun({
            churchId: c.churchId,
            memberId: m.id,
            stage: s.stage,
            channel,
            existing: byKey.get(`${m.id}|${s.stage}|${channel}`),
          });
          if (!runId) continue;

          if (!stagesClaimed.has(`${m.id}|${s.stage}`)) {
            stagesClaimed.add(`${m.id}|${s.stage}`);
            if (s.stage === "welcome") summary.welcome++;
            else summary.invites++;
          }

          jobs.push({
            runId,
            memberId: m.id,
            stage: s.stage,
            channel,
            phone: m.phone,
            email: m.email,
            name: m.firstName,
            message: fillTemplate(s.sms, vars),
            subject: fillTemplate(s.subject, vars),
            body: fillTemplate(s.body, vars),
          });
        }
      }
    }

    // ----- Email -----
    let emailsSent = 0;
    for (const job of jobs) {
      if (job.channel !== "email" || !job.email) continue;
      let detail: string | null = null;
      let ok = false;
      try {
        ok = await sendEmail({
          to: job.email,
          subject: job.subject,
          html: emailLayout(job.subject, job.body.replace(/\n/g, "<br>")),
          text: job.body,
          fromName: c.name,
        });
        if (!ok) detail = "The mail server did not accept the message.";
      } catch (err) {
        /*
         * Recorded, never swallowed. This used to be an empty catch, so a
         * church whose mail was misconfigured saw a successful sweep and a
         * visitor who heard nothing.
         */
        detail = err instanceof Error ? err.message : String(err);
      }
      if (ok) {
        emailsSent++;
        await finishRun(job.runId, "sent", null);
      } else {
        summary.failed++;
        await finishRun(job.runId, "failed", detail);
        console.error(
          `[first-timers] ${job.stage} email to member ${job.memberId} failed for church ${c.churchId}: ${detail}`,
        );
      }
    }
    if (emailsSent > 0) await recordUsage("email", c.churchId, emailsSent);
    summary.emails += emailsSent;

    // ----- SMS -----
    const smsJobs = jobs.filter((j) => j.channel === "sms" && j.phone);
    if (smsJobs.length === 0) continue;

    /*
     * A phone can belong to more than one member — a household sharing one
     * number, or the same visitor registered twice — so one number can carry
     * several messages and the gateway reports on each separately.
     *
     * The outcomes are therefore consumed one per message, in order, rather
     * than looked up: `sendChurchSmsBatch` returns a recipient's phone exactly
     * as it was handed in, so matching on the number alone would settle both
     * of a household's messages with whichever verdict arrived first and lose
     * the other. Order is the only thing that distinguishes them.
     */
    const pending = new Map<string, Job[]>();
    for (const j of smsJobs) {
      const list = pending.get(j.phone!) ?? [];
      list.push(j);
      pending.set(j.phone!, list);
    }

    const res = await sendChurchSmsBatch({
      churchId: c.churchId,
      recipients: smsJobs.map((j) => ({
        phone: j.phone!,
        message: j.message,
        memberId: j.memberId,
        name: j.name,
      })),
      label: "First-timer welcome & invites",
      origin: "first-timers",
    });

    if (res.ok === false) {
      /*
       * THE BRANCH THAT USED TO BE DROPPED ON THE FLOOR. Every first-timer in
       * this batch gets the reason on their run row, so the next sweep retries
       * them, and it is logged loudly because the causes — unapproved sender
       * ID, empty wallet, an unsupported country — are configuration, not
       * anything that will clear itself.
       */
      summary.failed += smsJobs.length;
      for (const j of smsJobs) await finishRun(j.runId, "failed", res.error);
      console.error(
        `[first-timers] SMS failed for church ${c.churchId} (${smsJobs.length} message(s)): ${res.error}`,
      );
      continue;
    }

    if (res.ok === "queued") {
      /*
       * Held for the delivery window. The queue owns these now, so they are
       * not retried here — and with `sendTime` gating the sweep this should
       * only happen for a church that has set a send time outside 8am–8pm.
       */
      summary.queued += res.count;
      for (const j of smsJobs) await finishRun(j.runId, "queued", res.notice);
      console.log(
        `[first-timers] ${res.count} message(s) queued for church ${c.churchId} until ${res.sendAfter.toISOString()}`,
      );
      continue;
    }

    summary.sms += res.sent;
    for (const o of res.outcomes) {
      const job = pending.get(o.phone)?.shift();
      if (!job) continue; // An outcome for a number this sweep did not send to.
      if (o.status === "sent") {
        await finishRun(job.runId, "sent", null);
      } else {
        summary.failed++;
        await finishRun(
          job.runId,
          "failed",
          o.error ?? `The number was ${o.status}.`,
        );
      }
    }
    /*
     * Anything left is a message the gateway never reported on. It would
     * otherwise stay `pending` for ever, which reads as "in flight" — one
     * rendered state meaning two different things. Say which, and let the next
     * sweep retry it.
     */
    for (const leftover of pending.values()) {
      for (const job of leftover) {
        summary.failed++;
        await finishRun(
          job.runId,
          "failed",
          "The gateway did not report on this number.",
        );
        console.error(
          `[first-timers] no gateway outcome for a recipient of church ${c.churchId} (member ${job.memberId})`,
        );
      }
    }
  }

  return summary;
}

/**
 * Take ownership of one member/stage/channel for this sweep, or decline.
 *
 * Returns the run row's id when this sweep may send, and null when it may not
 * — already sent, already handed to the queue, or attempted as often as it is
 * going to be. The write is conditional on the state that was read, so two
 * sweeps running at once cannot both claim the same message.
 */
async function claimRun(opts: {
  churchId: string;
  memberId: string;
  stage: Stage;
  channel: Channel;
  existing?: { id: string; outcome: string; attempts: number };
}): Promise<string | null> {
  const { churchId, memberId, stage, channel, existing } = opts;

  if (!existing) {
    const [row] = await db
      .insert(firstTimerRun)
      .values({
        churchId,
        memberId,
        stage,
        channel,
        outcome: "pending",
        attempts: 1,
      })
      .onConflictDoNothing()
      .returning({ id: firstTimerRun.id });
    // Nothing back means another sweep inserted it a moment ago. Leave it.
    return row?.id ?? null;
  }

  // Done, or somebody else's responsibility now.
  if (existing.outcome === "sent" || existing.outcome === "queued") return null;
  if (existing.attempts >= MAX_ATTEMPTS) return null;

  const [row] = await db
    .update(firstTimerRun)
    .set({ outcome: "pending", attempts: existing.attempts + 1, detail: null })
    .where(
      and(
        eq(firstTimerRun.id, existing.id),
        eq(firstTimerRun.outcome, existing.outcome),
      ),
    )
    .returning({ id: firstTimerRun.id });
  return row?.id ?? null;
}

/** Record what became of one message. */
async function finishRun(
  runId: string,
  outcome: "sent" | "queued" | "failed",
  detail: string | null,
): Promise<void> {
  await db
    .update(firstTimerRun)
    .set({ outcome, detail })
    .where(eq(firstTimerRun.id, runId));
}
