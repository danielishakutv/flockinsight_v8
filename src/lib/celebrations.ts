import "server-only";
import { and, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  member,
  celebrationRun,
  celebrationSetting,
  communicationLog,
} from "@/db/schema";
import { sendChurchSmsBatch } from "@/lib/church-sms";
import { recordRecipients, tally, type RecipientOutcome } from "@/lib/comm-recipients";
import { sendEmail, plainTextEmailLayout } from "@/lib/mailer";
import { recordUsage } from "@/lib/usage";
import { fillTemplate } from "@/lib/service-reminders";
import { managersToldSince, notifyChurchManagers } from "@/lib/notifications";
import { isValidTimeZone } from "@/lib/country-profile";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { smsWindowShutForToday } from "@/lib/sms-window";
import { inGoodStandingSql } from "@/lib/church-standing";
import { customAnniversaryOn } from "@/lib/celebration-sql";
import {
  celebrationKeysFor,
  celebrationWindow,
  displayZone,
  eventsForMember,
  localNow,
  windowLookup,
  yearsTo,
} from "@/lib/celebration-window";
import {
  CELEBRATION_MAX_ATTEMPTS,
  SMS_BATCH_REFUSED,
  SMS_INTERRUPTED_DETAIL,
  claimDecision,
  matchSmsOutcomes,
  smsRefusalAdvice,
} from "@/lib/celebration-runs";

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

const SEND_WINDOW_MIN = 150;
const DAY_MS = 86_400_000;

export type CelebrationSummary = {
  churchesChecked: number;
  emails: number;
  sms: number;
  /** Handed to the 8am–8pm SMS queue rather than sent now. */
  queued: number;
  /** Did not go out. The reason is on the run row, and it is retried. */
  failed: number;
  /**
   * Churches this run could not serve: a stored timezone Intl refuses, or an
   * error part-way through. Logged with the reason, never allowed to stop the
   * churches after it.
   */
  churchesSkipped: number;
};

type Channel = "sms" | "email";

/** One greeting on one channel, and the run row that tracks it. */
type Job = {
  runId: string;
  /** 1 on the first try today; a retry of a failure is 2 or 3. */
  attempt: number;
  memberId: string;
  channel: Channel;
  phone: string | null;
  email: string | null;
  name: string;
  /** The SMS text, filled in. */
  message: string;
  subject: string;
  body: string;
};

async function loadChurches(now: Date) {
  return db
    .select({
      churchId: celebrationSetting.churchId,
      sms: celebrationSetting.sms,
      email: celebrationSetting.email,
      sendTime: celebrationSetting.sendTime,
      birthdaySms: celebrationSetting.birthdaySms,
      birthdayEmailSubject: celebrationSetting.birthdayEmailSubject,
      birthdayEmailBody: celebrationSetting.birthdayEmailBody,
      anniversarySms: celebrationSetting.anniversarySms,
      anniversaryEmailSubject: celebrationSetting.anniversaryEmailSubject,
      anniversaryEmailBody: celebrationSetting.anniversaryEmailBody,
      name: church.name,
      timezone: church.timezone,
      country: church.country,
    })
    .from(celebrationSetting)
    .innerJoin(church, eq(church.id, celebrationSetting.churchId))
    .where(
      and(
        eq(celebrationSetting.enabled, true),
        eq(church.status, "active"),
        // Not for a church behind the paywall, whose admins can no longer
        // reach the setting that turns this off. See church-standing.ts.
        inGoodStandingSql(now),
      ),
    );
}

type ChurchRow = Awaited<ReturnType<typeof loadChurches>>[number];

/**
 * Send birthday & anniversary messages due today. Run every five minutes by
 * the scheduler, so "send at 08:00" is honoured at 08:00 — see CRON_JOBS. A
 * failed greeting is retried an hour later, not at the next sweep (see
 * claimDecision), so the attempt budget is still three across the window.
 *
 * THREE THINGS THIS GOT WRONG, AND WHY IT NOW LOOKS LIKE first-timers.ts.
 *
 * It wrote the run row BEFORE sending and never looked at the result. The row
 * stopped a second run sending twice, and it also marked a greeting whose
 * email hit a Resend 429, or whose SMS met an empty wallet, as done for the
 * day — never retried, never recorded, and the church believed its members
 * had been greeted. Rows are now one per channel, written "pending" and
 * settled with what happened; a failure is retried on the next hourly run
 * inside the send window, and a channel that went is never sent again.
 *
 * It ignored `ok: false` from the SMS batch, so "sender ID not approved" and
 * "not enough balance" vanished. They are recorded on every row, logged, and
 * the church's managers are told — at most once a week, so a church that has
 * decided not to fix it is not nagged daily.
 *
 * One church could stop it for everybody. A timezone Intl refuses threw out of
 * the loop, and every church after it got no greetings that day. Each church
 * now runs in its own try/catch, and a bad timezone skips that church with
 * the reason logged.
 */
export async function runCelebrations(
  now: Date = new Date(),
): Promise<CelebrationSummary> {
  const churches = await loadChurches(now);

  const summary: CelebrationSummary = {
    churchesChecked: churches.length,
    emails: 0,
    sms: 0,
    queued: 0,
    failed: 0,
    churchesSkipped: 0,
  };

  for (const c of churches) {
    try {
      await runChurch(c, now, summary);
    } catch (e) {
      summary.churchesSkipped++;
      console.error(
        `[celebrations] church ${c.churchId} failed part-way; carrying on with the others`,
        e,
      );
    }
  }

  return summary;
}

async function runChurch(
  c: ChurchRow,
  now: Date,
  summary: CelebrationSummary,
): Promise<void> {
  if (!c.sms && !c.email) return;

  const tz = c.timezone || "Africa/Lagos";
  if (!isValidTimeZone(tz)) {
    // Not guessed: greeting a whole church on the wrong day is worse than a
    // day missed and a log line saying exactly why.
    summary.churchesSkipped++;
    console.error(
      `[celebrations] church ${c.churchId} skipped: its timezone "${tz}" is not one Intl recognises. Fix it in Settings → Church profile.`,
    );
    return;
  }

  const local = localNow(tz, now);
  const sendMin = toMinutes(c.sendTime);
  if (local.minutes < sendMin || local.minutes - sendMin > SEND_WINDOW_MIN) return;

  /*
   * SMS only where it can be delivered. Elsewhere the batch refuses (charging
   * nothing), and that refusal used to be dropped, so a member with only a
   * phone number was never greeted and nothing said why. The settings page no
   * longer offers SMS there; this covers a setting saved before it stopped.
   */
  const smsOn = c.sms && smsAvailableForCountry(c.country);
  if (c.sms && !smsOn)
    console.warn(
      `[celebrations] church ${c.churchId} has SMS greetings on, but SMS isn't available in ${c.country || "its country"}; greeting by email only.`,
    );
  if (!smsOn && !c.email) return;

  const runStart = new Date();
  const today = local.date;
  const year = Number(today.slice(0, 4));
  // 28 Feb in a year without a 29th also greets the leap-day births.
  const keys = celebrationKeysFor(today.slice(5), year);

  const members = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      phone: member.phone,
      email: member.email,
      isMinor: member.isMinor,
      guardianId: member.guardianId,
      dateOfBirth: member.dateOfBirth,
      weddingDate: member.weddingDate,
      baptismDate: member.baptismDate,
      anniversaries: member.anniversaries,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, c.churchId),
        or(
          inArray(sql`to_char(${member.dateOfBirth}, 'MM-DD')`, keys),
          inArray(sql`to_char(${member.weddingDate}, 'MM-DD')`, keys),
          inArray(sql`to_char(${member.baptismDate}, 'MM-DD')`, keys),
          customAnniversaryOn(keys),
        ),
      ),
    )
    .limit(2000);
  if (members.length === 0) return;

  // A child usually has no contact of their own, so their celebration reaches
  // their parent/guardian instead. Fetch guardians' contact in one query.
  const guardianIds = [
    ...new Set(
      members
        .filter((m) => m.isMinor && m.guardianId && !m.phone && !m.email)
        .map((m) => m.guardianId as string),
    ),
  ];
  const guardianContact = new Map<
    string,
    { phone: string | null; email: string | null }
  >();
  if (guardianIds.length > 0) {
    const gs = await db
      .select({ id: member.id, phone: member.phone, email: member.email })
      .from(member)
      .where(
        and(
          eq(member.churchId, c.churchId),
          inArray(member.id, guardianIds),
        ),
      );
    for (const g of gs)
      guardianContact.set(g.id, { phone: g.phone, email: g.email });
  }

  // Today's run rows for this church, in one read.
  const runRows = await db
    .select({
      id: celebrationRun.id,
      memberId: celebrationRun.memberId,
      kind: celebrationRun.kind,
      channel: celebrationRun.channel,
      outcome: celebrationRun.outcome,
      attempts: celebrationRun.attempts,
      updatedAt: celebrationRun.updatedAt,
    })
    .from(celebrationRun)
    .where(
      and(eq(celebrationRun.churchId, c.churchId), eq(celebrationRun.onDate, today)),
    );
  const byKey = new Map(
    runRows.map((r) => [`${r.memberId}|${r.kind}|${r.channel}`, r]),
  );

  const jobs: Job[] = [];
  for (const m of members) {
    // Route to the child's own contact when they have one, else their
    // guardian's (children are celebrated via their parents).
    const g =
      m.isMinor && m.guardianId ? guardianContact.get(m.guardianId) : undefined;
    const toPhone = m.phone || g?.phone || null;
    const toEmail = m.email || g?.email || null;

    for (const ev of eventsForMember(m, keys, year)) {
      // A row from before channels covers both, and it was sent.
      if (byKey.has(`${m.id}|${ev.kind}|all`)) continue;

      const wanted: Channel[] = [];
      if (smsOn && toPhone) wanted.push("sms");
      if (c.email && toEmail) wanted.push("email");
      if (wanted.length === 0) continue;

      const isBirthday = ev.kind === "birthday";
      const vars = {
        name: m.firstName,
        church: c.name,
        occasion: ev.occasion,
        years: ev.years ? String(ev.years) : "",
      };

      for (const channel of wanted) {
        const claim = await claimRun({
          churchId: c.churchId,
          memberId: m.id,
          kind: ev.kind,
          onDate: today,
          channel,
          existing: byKey.get(`${m.id}|${ev.kind}|${channel}`),
          now,
        });
        if (!claim) continue;
        jobs.push({
          runId: claim.id,
          attempt: claim.attempt,
          memberId: m.id,
          channel,
          phone: toPhone,
          email: toEmail,
          name: m.firstName,
          message: fillTemplate(isBirthday ? c.birthdaySms : c.anniversarySms, vars),
          subject: fillTemplate(
            isBirthday ? c.birthdayEmailSubject : c.anniversaryEmailSubject,
            vars,
          ),
          body: fillTemplate(
            isBirthday ? c.birthdayEmailBody : c.anniversaryEmailBody,
            vars,
          ),
        });
      }
    }
  }

  // ----- Email -----
  let emails = 0;
  const emailHistory: RecipientOutcome[] = [];
  for (const job of jobs) {
    if (job.channel !== "email" || !job.email) continue;
    let ok = false;
    let detail: string | null = null;
    try {
      ok = await sendEmail({
        to: job.email,
        subject: job.subject,
        html: plainTextEmailLayout(job.subject, job.body),
        text: job.body,
        fromName: c.name,
      });
      if (!ok) detail = "The mail server did not accept the message.";
    } catch (err) {
      // Recorded, never swallowed: this used to be an empty catch.
      detail = err instanceof Error ? err.message : String(err);
    }
    emailHistory.push({
      memberId: job.memberId,
      name: job.name,
      destination: job.email,
      status: ok ? "sent" : "failed",
      error: detail,
    });
    if (ok) {
      emails++;
      await finishRun(job.runId, "sent", null);
    } else {
      summary.failed++;
      await finishRun(job.runId, "failed", detail);
      console.error(
        `[celebrations] email to member ${job.memberId} failed for church ${c.churchId} (attempt ${job.attempt} of ${CELEBRATION_MAX_ATTEMPTS}): ${detail}`,
      );
    }
  }
  if (emails > 0) await recordUsage("email", c.churchId, emails);
  summary.emails += emails;
  const firstEmail = jobs.find((j) => j.channel === "email" && j.email);
  if (firstEmail)
    await logToHistory(c.churchId, "email", {
      subject: firstEmail.subject,
      body: firstEmail.body,
      outcomes: emailHistory,
    });

  // ----- SMS -----
  const smsJobs = jobs
    .filter((j) => j.channel === "sms" && j.phone)
    .map((j) => ({ ...j, phone: j.phone as string }));
  if (smsJobs.length === 0) return;
  const smsHistory = (status: "sent" | "failed", error: string | null) =>
    logToHistory(c.churchId, "sms", {
      body: smsJobs[0].message,
      outcomes: smsJobs.map((j) => ({
        memberId: j.memberId,
        name: j.name,
        destination: j.phone,
        status,
        error,
      })),
    });

  /*
   * After 8pm the batch would be queued for 8am tomorrow, so "celebrates you
   * today" arrived a day late, and was charged. An evening send time did it,
   * and so did a retry that slipped past 8pm. Those texts are now settled as
   * failed, for good, with the reason; the emails above still went. Before
   * 8am is different, because 08:00 is still today, so that is left to the
   * queue. Read off the clock rather than `now`, since the emails can take
   * minutes.
   */
  if (smsWindowShutForToday(new Date(), tz)) {
    const detail =
      "Texts can't be delivered after 8pm, so this greeting was not sent by SMS. Choose a send time between 08:00 and 18:00 in Settings → Celebrations.";
    summary.failed += smsJobs.length;
    for (const j of smsJobs) await finishRun(j.runId, "failed", detail, { final: true });
    console.warn(
      `[celebrations] ${smsJobs.length} SMS greeting(s) for church ${c.churchId} not sent: it is past 8pm there, so they would have arrived tomorrow`,
    );
    await smsHistory("failed", detail);
    await tellManagersTooLateOnceAWeek(c, now, smsJobs.length);
    return;
  }

  let res: Awaited<ReturnType<typeof sendChurchSmsBatch>>;
  try {
    res = await sendChurchSmsBatch({
      churchId: c.churchId,
      recipients: smsJobs.map((j) => ({
        phone: j.phone,
        message: j.message,
        memberId: j.memberId,
        name: j.name,
      })),
      // Also the history label if the batch waits in the 8am queue.
      label: CELEBRATION_AUDIENCE,
      origin: "celebrations",
    });
  } catch (e) {
    /*
     * Our own code failing around the gateway, which may already have sent
     * some of it. Recorded as failed and NOT retried: a second birthday text
     * charged to the church is worse than one that may not have arrived.
     */
    const detail = `The SMS send stopped on an internal error, so some may have gone: ${e instanceof Error ? e.message : String(e)}`;
    summary.failed += smsJobs.length;
    for (const j of smsJobs) await finishRun(j.runId, "failed", detail, { final: true });
    console.error(`[celebrations] SMS batch threw for church ${c.churchId}`, e);
    await smsHistory("failed", detail);
    return;
  }

  if (res.ok === false) {
    /*
     * THE BRANCH THAT USED TO BE DROPPED. Sender ID not approved, not enough
     * balance: every greeting in the batch gets the reason, the next hourly
     * run inside the window retries them, and the managers hear about it —
     * because only they can top up or chase the sender ID.
     */
    summary.failed += smsJobs.length;
    // Prefixed so tellManagersOnceAWeek can tell a refused batch (which it
    // warned about) from one bad number in a batch that otherwise went.
    for (const j of smsJobs)
      await finishRun(j.runId, "failed", `${SMS_BATCH_REFUSED}${res.error}`);
    console.error(
      `[celebrations] SMS failed for church ${c.churchId} (${smsJobs.length} greeting(s)): ${res.error}`,
    );
    await tellManagersOnceAWeek(c.churchId, runStart, smsJobs.length, res.error);
    await smsHistory("failed", `${SMS_BATCH_REFUSED}${res.error}`);
    return;
  }

  if (res.ok === "queued") {
    // The queue owns these now, so they are not retried here — and it writes
    // the history row when they actually go (origin "celebrations").
    summary.queued += res.count;
    for (const j of smsJobs) await finishRun(j.runId, "queued", res.notice);
    console.log(
      `[celebrations] ${res.count} greeting(s) queued for church ${c.churchId} until ${res.sendAfter.toISOString()}`,
    );
    return;
  }

  // `ok === true`: settle each greeting with its own number's verdict.
  summary.sms += res.sent;
  const { settled, unreported } = matchSmsOutcomes(smsJobs, res.outcomes);
  const history: RecipientOutcome[] = [];
  for (const s of settled) {
    history.push({
      memberId: s.job.memberId,
      name: s.job.name,
      destination: s.job.phone,
      status: s.ok ? "sent" : "failed",
      error: s.error,
      providerMessageId: s.providerMessageId ?? null,
    });
    if (s.ok) {
      await finishRun(s.job.runId, "sent", null);
    } else {
      summary.failed++;
      await finishRun(s.job.runId, "failed", s.error);
    }
  }
  for (const j of unreported) {
    // Left "pending" it would read as in flight — one state meaning two things.
    summary.failed++;
    await finishRun(j.runId, "failed", "The gateway did not report on this number.");
    history.push({
      memberId: j.memberId,
      name: j.name,
      destination: j.phone,
      status: "failed",
      error: "The gateway did not report on this number.",
    });
    console.error(
      `[celebrations] no gateway outcome for a recipient of church ${c.churchId} (member ${j.memberId})`,
    );
  }
  await logToHistory(c.churchId, "sms", {
    body: smsJobs[0].message,
    outcomes: history,
    units: res.pages,
    cost: res.cost,
  });
}

/**
 * Put an automatic greeting in Communication → History, beside what the
 * church sent by hand.
 *
 * It used to be recorded only in celebration_run, which no page reads. On
 * 15 Oct 2026 RPM Magami's 08:00 birthday text to a member went, and Termii
 * reported it delivered — but nothing anywhere in the app said so, so an admin
 * concluded "it doesn't go by itself", sent it again by hand at 11:12, and the
 * member got two and the church paid twice. A greeting that went and cannot
 * be seen is, to the church, a greeting that did not go.
 *
 * The recipient rows carry the gateway's message id, so Termii's delivery
 * report can turn "sent" into "delivered". Best-effort: failing to write the
 * history must never undo or repeat a greeting that already went.
 */
async function logToHistory(
  churchId: string,
  channel: Channel,
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
        audience: CELEBRATION_AUDIENCE,
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
      `[celebrations] greeting went but could not be written to the history for church ${churchId}:`,
      e,
    );
  }
}

/** How automatic greetings are labelled in Communication → History. */
const CELEBRATION_AUDIENCE = "Birthday & anniversary wishes (automatic)";

/**
 * Take ownership of one greeting on one channel for this run, or decline.
 * See `claimDecision` for when; the write repeats the state it read, so two
 * overlapping runs cannot both claim it.
 */
async function claimRun(o: {
  churchId: string;
  memberId: string;
  kind: string;
  onDate: string;
  channel: Channel;
  existing?: { id: string; outcome: string; attempts: number; updatedAt: Date };
  now: Date;
}): Promise<{ id: string; attempt: number } | null> {
  const decision = claimDecision(o.existing, o.now, o.channel);
  if (decision === "leave") return null;

  if (decision === "abandon" && o.existing) {
    // Settled as failed and final, on the state it was read in: if another run
    // settled it first, this changes nothing. Either way nothing is sent.
    const ex = o.existing;
    const done = await db
      .update(celebrationRun)
      .set({
        outcome: "failed",
        attempts: CELEBRATION_MAX_ATTEMPTS,
        detail: SMS_INTERRUPTED_DETAIL,
      })
      .where(
        and(
          eq(celebrationRun.id, ex.id),
          eq(celebrationRun.outcome, "pending"),
          eq(celebrationRun.attempts, ex.attempts),
        ),
      )
      .returning({ id: celebrationRun.id });
    if (done.length > 0)
      console.warn(
        `[celebrations] SMS greeting ${ex.id} for church ${o.churchId} was claimed by a run that never finished; recorded as failed, not resent.`,
      );
    return null;
  }

  if (decision === "insert" || !o.existing) {
    const [row] = await db
      .insert(celebrationRun)
      .values({
        churchId: o.churchId,
        memberId: o.memberId,
        kind: o.kind,
        onDate: o.onDate,
        channel: o.channel,
        outcome: "pending",
        attempts: 1,
      })
      .onConflictDoNothing()
      .returning({ id: celebrationRun.id });
    // Nothing back: another run inserted it a moment ago. Theirs to send.
    return row ? { id: row.id, attempt: 1 } : null;
  }

  const ex = o.existing;
  const [row] = await db
    .update(celebrationRun)
    .set({ outcome: "pending", attempts: ex.attempts + 1, detail: null })
    .where(
      and(
        eq(celebrationRun.id, ex.id),
        eq(celebrationRun.outcome, ex.outcome),
        eq(celebrationRun.attempts, ex.attempts),
      ),
    )
    .returning({ id: celebrationRun.id });
  return row ? { id: row.id, attempt: ex.attempts + 1 } : null;
}

/** Record what became of one greeting. `final` stops any further retry. */
async function finishRun(
  runId: string,
  outcome: "sent" | "queued" | "failed",
  detail: string | null,
  opts: { final?: boolean } = {},
): Promise<void> {
  await db
    .update(celebrationRun)
    .set({
      outcome,
      detail,
      ...(opts.final ? { attempts: CELEBRATION_MAX_ATTEMPTS } : {}),
    })
    .where(eq(celebrationRun.id, runId));
}

/**
 * Tell the church's managers their birthday texts did not go — unless they
 * were already told this week.
 *
 * "Already told" is read from the run rows themselves: a greeting whose whole
 * batch was refused (its detail starts with SMS_BATCH_REFUSED), created before
 * this run started and within the last seven days, means an earlier run met
 * the same wall and sent this notice. So a retry an hour later says nothing
 * new, and a church that has chosen not to top up hears about it weekly
 * rather than every morning.
 *
 * Only refused batches count. Any failed SMS row used to, so one member's
 * invalid number in an otherwise successful send — which sends no notice —
 * silenced the "your wallet is empty" notice for the following week.
 */
async function tellManagersOnceAWeek(
  churchId: string,
  runStart: Date,
  count: number,
  reason: string,
): Promise<void> {
  const [earlier] = await db
    .select({ id: celebrationRun.id })
    .from(celebrationRun)
    .where(
      and(
        eq(celebrationRun.churchId, churchId),
        eq(celebrationRun.channel, "sms"),
        eq(celebrationRun.outcome, "failed"),
        like(celebrationRun.detail, `${SMS_BATCH_REFUSED}%`),
        gte(celebrationRun.createdAt, new Date(runStart.getTime() - 7 * DAY_MS)),
        lt(celebrationRun.createdAt, runStart),
      ),
    )
    .limit(1);
  if (earlier) return;
  await notifyChurchManagers({
    churchId,
    title: "Birthday & anniversary texts were not sent",
    body: `${count} greeting${count === 1 ? "" : "s"} could not be sent by SMS today: ${reason} They will be tried again within the send window. ${smsRefusalAdvice(reason)}`,
    linkUrl: "/settings/celebrations",
    email: true,
  });
}

/**
 * Tell the managers their birthday texts were dropped for being after 8pm,
 * unless they were already told this week. A send time saved before the
 * settings page refused evening times still stands, and only they can change
 * it. Until they do no greeting goes by SMS at all, which a History row alone
 * would not make anybody notice.
 */
async function tellManagersTooLateOnceAWeek(
  c: ChurchRow,
  now: Date,
  count: number,
): Promise<void> {
  const title = `${c.name}: birthday & anniversary texts were not sent after 8pm`;
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
    body: `${count} greeting${count === 1 ? "" : "s"} could not be sent by SMS today: networks only deliver texts between 8am and 8pm, and it was past 8pm where your church is. The emails still went. Choose a send time between 08:00 and 18:00 in Settings → Celebrations, or turn SMS off for celebrations.`,
    linkUrl: "/settings/celebrations",
    email: true,
  });
}

/** The church's timezone for a display, falling back when it is unusable. */
export async function churchDisplayZone(churchId: string): Promise<string> {
  const [c] = await db
    .select({ timezone: church.timezone })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return displayZone(c?.timezone);
}

export type QueueItem = {
  id: string;
  name: string;
  kind: string;
  label: string; // occasion
  dateLabel: string;
  offset: number;
  years: number | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Members with a birthday, wedding or baptism date in the window — filtered by
 * the window in SQL, so a cap can only ever cut from far down the list.
 *
 * It used to load ANY members with one of those dates and filter in JS
 * afterwards, so a church with more dated members than the cap silently lost
 * some of the window's celebrants, today's included. Custom anniversaries are
 * matched on the window in SQL too (see customAnniversaryOn).
 */
async function membersInWindow(churchId: string, keys: string[], cap: number) {
  return db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth,
      weddingDate: member.weddingDate,
      baptismDate: member.baptismDate,
      anniversaries: member.anniversaries,
    })
    .from(member)
    .where(
      and(
        eq(member.churchId, churchId),
        or(
          inArray(sql`to_char(${member.dateOfBirth}, 'MM-DD')`, keys),
          inArray(sql`to_char(${member.weddingDate}, 'MM-DD')`, keys),
          inArray(sql`to_char(${member.baptismDate}, 'MM-DD')`, keys),
          customAnniversaryOn(keys),
        ),
      ),
    )
    .limit(cap);
}

/**
 * Upcoming birthdays + anniversaries for the next `days` days (for preview).
 *
 * "Today" is today WHERE THE CHURCH IS — the same day the cron greets — not
 * the server's. Pass the church's timezone when you have it; otherwise it is
 * looked up.
 */
export async function getCelebrationQueue(
  churchId: string,
  days = 14,
  timezone?: string,
): Promise<QueueItem[]> {
  const tz = timezone !== undefined ? displayZone(timezone) : await churchDisplayZone(churchId);
  const lookup = windowLookup(celebrationWindow(tz, days));
  const rows = await membersInWindow(churchId, [...lookup.keys()], 2000);

  const items: QueueItem[] = [];
  const add = (
    r: (typeof rows)[number],
    iso: string | null,
    kind: string,
    occasion: string,
  ) => {
    if (!iso) return;
    const w = lookup.get(iso.slice(5));
    if (!w) return;
    items.push({
      id: `${r.id}-${kind}`,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      kind,
      label: occasion,
      dateLabel:
        w.offset === 0 ? "Today" : w.offset === 1 ? "Tomorrow" : `${MONTHS[w.month]} ${w.day}`,
      offset: w.offset,
      years: yearsTo(iso, w.year),
    });
  };
  for (const r of rows) {
    add(r, r.dateOfBirth, "birthday", "Birthday");
    add(r, r.weddingDate, "wedding", "Wedding anniversary");
    add(r, r.baptismDate, "baptism", "Baptism anniversary");
    for (const a of r.anniversaries ?? []) add(r, a.date, a.label, a.label);
  }
  return items.sort((a, b) => a.offset - b.offset).slice(0, 40);
}

export type CelebrationCategory = "birthday" | "wedding" | "baptism" | "other";

export type CelebrationListItem = {
  id: string;
  memberId: string;
  name: string;
  category: CelebrationCategory;
  occasion: string;
  dateLabel: string;
  offset: number;
  years: number | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A full "view all" list of upcoming birthdays & anniversaries over the next
 * `days` days, each tagged with a filterable category. Used by the /celebrations
 * directory page (no send — display only). Days are the church's own, as in
 * {@link getCelebrationQueue}.
 */
export async function getUpcomingCelebrations(
  churchId: string,
  days = 90,
  timezone?: string,
): Promise<CelebrationListItem[]> {
  const tz = timezone !== undefined ? displayZone(timezone) : await churchDisplayZone(churchId);
  const lookup = windowLookup(celebrationWindow(tz, days));
  const rows = await membersInWindow(churchId, [...lookup.keys()], 5000);

  const items: CelebrationListItem[] = [];
  const add = (
    r: (typeof rows)[number],
    iso: string | null,
    category: CelebrationCategory,
    occasion: string,
  ) => {
    if (!iso) return;
    const w = lookup.get(iso.slice(5));
    if (!w) return;
    items.push({
      id: `${r.id}-${category}-${occasion}`,
      memberId: r.id,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      category,
      occasion,
      dateLabel:
        w.offset === 0
          ? "Today"
          : w.offset === 1
            ? "Tomorrow"
            : `${WEEKDAYS[w.weekday]}, ${w.day} ${MONTHS[w.month]}`,
      offset: w.offset,
      years: yearsTo(iso, w.year),
    });
  };
  for (const r of rows) {
    add(r, r.dateOfBirth, "birthday", "Birthday");
    add(r, r.weddingDate, "wedding", "Wedding anniversary");
    add(r, r.baptismDate, "baptism", "Baptism anniversary");
    for (const a of r.anniversaries ?? []) add(r, a.date, "other", a.label);
  }
  return items.sort((a, b) => a.offset - b.offset).slice(0, 500);
}
