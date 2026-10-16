import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  communicationLog,
  scheduledSms,
  user,
} from "@/db/schema";
import { recordRecipients, type RecipientOutcome } from "@/lib/comm-recipients";
import {
  SMS_WINDOW_LABEL,
  nextSmsWindowStart,
  smsWindowNotice,
  withinSmsWindow,
} from "@/lib/sms-window";
import { MAX_SMS_ATTEMPTS, RETRY_AFTER_MS, queueVerdict } from "@/lib/sms-queue-rules";

/**
 * SMS that arrived outside the 8am–8pm delivery window, and the worker that
 * sends it when the window opens. Also the way a composer send too big for one
 * web request goes out: queued due now, and sent after the response.
 *
 * Two rules shape this file.
 *
 * NOTHING IS CHARGED UNTIL IT GOES. A queued message that somebody cancels at
 * midnight must cost nothing, and a wallet debited the night before for a send
 * that happens in the morning cannot be reconciled against anything.
 *
 * THE LIST IS FROZEN AT QUEUE TIME. The recipients are stored as they were
 * resolved, not as a rule to re-run — "all members" at 8am is a different list
 * from "all members" at 10pm, and the person who pressed Send approved the one
 * they were looking at.
 */

export type QueuedResult = {
  ok: "queued";
  /** The queue row, so a caller sending it now can hand it to the worker. */
  id: string;
  sendAfter: Date;
  count: number;
  notice: string;
  /** True when it is going out now in the background, not waiting for 8am. */
  sendingNow: boolean;
};

/**
 * Park a send - until the window opens, or (`sendNow`) due immediately for a
 * worker to pick up after the response. Returns what the caller tells the user.
 *
 * `requestId` is one press of Send. The column is unique, so a second row for
 * the same press is refused here and the congregation is not texted twice.
 */
export async function queueChurchSms(opts: {
  churchId: string;
  timezone: string;
  audience: string;
  body: string;
  recipients: {
    phone: string;
    message: string;
    memberId?: string | null;
    name?: string | null;
  }[];
  origin?: string;
  reason?: string | null;
  userId?: string | null;
  requestId?: string | null;
  sendNow?: boolean;
}): Promise<QueuedResult | { ok: false; error: string; duplicate?: boolean }> {
  const now = new Date();
  const sendAfter = opts.sendNow ? now : nextSmsWindowStart(now, opts.timezone);

  const [row] = await db
    .insert(scheduledSms)
    .values({
      churchId: opts.churchId,
      audience: opts.audience.slice(0, 200),
      body: opts.body,
      recipients: opts.recipients.map((r) => ({
        phone: r.phone,
        message: r.message,
        memberId: r.memberId ?? null,
        name: r.name ?? null,
      })),
      origin: opts.origin ?? "communication",
      reason: opts.reason ?? null,
      sendAfter,
      requestId: opts.requestId ?? null,
      createdBy: opts.userId ?? null,
    })
    .onConflictDoNothing({ target: scheduledSms.requestId })
    .returning({ id: scheduledSms.id });

  if (!row) {
    return {
      ok: false,
      // Marked, so the composer keeps the same request id for the next press
      // and that one is refused too, rather than going out as a fresh copy.
      duplicate: true,
      error:
        "This message is already being sent. Check the queue and History before sending it again.",
    };
  }

  console.log(
    `[sms-queue] ${opts.sendNow ? "sending" : "held"} ${opts.recipients.length} message(s) for church ${opts.churchId}${opts.sendNow ? " now" : ` until ${sendAfter.toISOString()}`} (${row.id})`,
  );

  const n = opts.recipients.length;
  return {
    ok: "queued",
    id: row.id,
    sendAfter,
    count: n,
    sendingNow: !!opts.sendNow,
    notice: opts.sendNow
      ? `Sending to ${n} ${n === 1 ? "person" : "people"} now. A large send takes a few minutes; it appears in History when it is done, and your wallet is charged only for the messages that go.`
      : smsWindowNotice(sendAfter, opts.timezone),
  };
}

export type QueuedSms = {
  id: string;
  audience: string;
  /**
   * The wording — or null when it must not be shown.
   *
   * Only a message the church composed itself is readable here. An automatic
   * one can carry a credential: a member's self-update link is a bearer token
   * in a URL, and printing it in a shared list would let anyone who can open
   * this page edit that member's details. The audience and the time still
   * show, which is everything needed to recognise or cancel it.
   */
  body: string | null;
  recipients: number;
  origin: string;
  sendAfter: string;
  status: string;
  error: string | null;
  createdByName: string | null;
  createdAt: string;
};

/**
 * What this church has waiting, what is going out right now, and what went
 * wrong.
 *
 * What can still be acted on comes first - going out now, then waiting, the
 * soonest first - and only then the fortnight of problems, newest first. In
 * plain time order a church with twenty old failures could not see, or
 * cancel, the message actually waiting for 8am: the limit cut it off.
 */
export async function listQueuedSms(
  churchId: string,
  limit = 20,
): Promise<QueuedSms[]> {
  const rows = await db
    .select({
      id: scheduledSms.id,
      audience: scheduledSms.audience,
      body: scheduledSms.body,
      recipients: sql<number>`jsonb_array_length(${scheduledSms.recipients})::int`,
      origin: scheduledSms.origin,
      sendAfter: scheduledSms.sendAfter,
      status: scheduledSms.status,
      error: scheduledSms.error,
      createdByName: user.name,
      createdAt: scheduledSms.createdAt,
    })
    .from(scheduledSms)
    .leftJoin(user, eq(user.id, scheduledSms.createdBy))
    .where(
      and(
        eq(scheduledSms.churchId, churchId),
        /*
         * Clean sends are in the communication history, where they belong.
         * This list is what has not happened yet, what is happening now
         * ("sending" - including one a restart interrupted, which the worker
         * turns into a failure with a reason), and what went wrong: a failure,
         * or a send that went to only some of its list. An automatic send
         * writes no history row, so for those this is the only place a
         * shortfall can be seen at all.
         */
        or(
          inArray(scheduledSms.status, ["queued", "sending"]),
          // What went wrong stays for a fortnight - long enough to be seen and
          // acted on, not so long that old news crowds out what is waiting.
          and(
            gte(scheduledSms.createdAt, new Date(Date.now() - 14 * 86_400_000)),
            or(
              eq(scheduledSms.status, "failed"),
              and(eq(scheduledSms.status, "sent"), isNotNull(scheduledSms.error)),
            ),
          ),
        ),
      ),
    )
    .orderBy(
      sql`case ${scheduledSms.status} when 'sending' then 0 when 'queued' then 1 else 2 end`,
      // Waiting rows soonest first; the rest are ordered by createdAt below.
      sql`case when ${scheduledSms.status} in ('sending', 'queued') then ${scheduledSms.sendAfter} end asc`,
      desc(scheduledSms.createdAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    /*
     * Redacted by default, revealed only for the composer.
     *
     * Deliberately a whitelist: a sender added later that happens to put a
     * token in a message is then private without anybody remembering to say
     * so. The alternative — listing the senders to hide — is a list that is
     * one forgotten line away from leaking a link.
     */
    body: r.origin === "communication" ? r.body : null,
    recipients: Number(r.recipients),
    sendAfter: r.sendAfter.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Cancel a queued send. Scoped to the church, so an id from a form can only
 * ever cancel something that church owns.
 */
export async function cancelQueuedSms(
  churchId: string,
  id: string,
): Promise<boolean> {
  const done = await db
    .update(scheduledSms)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(scheduledSms.id, id),
        eq(scheduledSms.churchId, churchId),
        // Only something still waiting. Cancelling a sent message is not a
        // thing that can happen, and claiming it did would be a lie.
        eq(scheduledSms.status, "queued"),
      ),
    )
    .returning({ id: scheduledSms.id });
  return done.length > 0;
}

/**
 * How long past its moment a queued message may still be sent.
 *
 * ADDED AFTER FINDING THE QUEUE HAD NEVER BEEN FLUSHED IN PRODUCTION. The
 * `sms-queue` job was missing from the crontab, so every message handed in
 * outside the 8am-8pm delivery window had been sitting in this table
 * unsent — and `flushSmsQueue` had no notion of staleness, so simply adding
 * the cron line would have sent the entire backlog: "thanks for visiting"
 * texts to people who visited two months ago, reminders for services already
 * held, and the church's wallet charged for all of it.
 *
 * A church SMS is a thing with a moment. One delivered a day late is not the
 * message that was written, so past this it is marked failed with the reason
 * rather than delivered. The row is kept, so it is auditable and countable.
 *
 * 24 hours, not less: the normal lag is minutes (a message queued at 9pm goes
 * at 8am, and `sendAfter` is already the 8am), and a retry pushes `sendAfter`
 * forward 30 minutes, so nothing legitimate comes close to a day.
 */
const STALE_AFTER_HOURS = 24;

/**
 * How long a row may sit in "sending" before it is presumed abandoned.
 *
 * The claim sets `sendAfter` to the moment it was claimed, so this measures
 * from then. A batch with its gateway calls running five at a time finishes in
 * minutes even for a large congregation; an hour is far past any real send
 * and still the same morning for the church.
 */
const STUCK_AFTER_MINUTES = 60;

export type FlushReport = {
  considered: number;
  sent: number;
  held: number;
  failed: number;
  /** Too old to be worth delivering. See STALE_AFTER_HOURS. */
  expired: number;
  /** Left in "sending" by a restart or a crash. See STUCK_AFTER_MINUTES. */
  stuck: number;
};

type DueRow = {
  id: string;
  churchId: string;
  audience: string;
  body: string;
  recipients: { phone: string; message: string; memberId?: string | null; name?: string | null }[];
  origin: string;
  reason: string | null;
  createdBy: string | null;
  attempts: number;
  timezone: string;
};

const dueColumns = {
  id: scheduledSms.id,
  churchId: scheduledSms.churchId,
  audience: scheduledSms.audience,
  body: scheduledSms.body,
  recipients: scheduledSms.recipients,
  origin: scheduledSms.origin,
  reason: scheduledSms.reason,
  createdBy: scheduledSms.createdBy,
  attempts: scheduledSms.attempts,
  timezone: church.timezone,
};

/**
 * Send everything that is due and inside its church's window.
 *
 * Called by /api/cron/sms-queue every few minutes. Each row is claimed with a
 * conditional update before anything is sent, so two overlapping cron runs
 * cannot both hand the same batch to the gateway — the second claim matches no
 * rows and does nothing.
 */
export async function flushSmsQueue(now: Date = new Date()): Promise<FlushReport> {
  /*
   * Expire the long-dead first, before anything is considered for sending.
   *
   * One statement, and it runs before the batch is read so a stale row cannot
   * be picked up by the same pass. Marked failed with the reason in `error`,
   * where the church's SMS history shows it.
   */
  const staleBefore = new Date(now.getTime() - STALE_AFTER_HOURS * 3_600_000);
  const expired = await db
    .update(scheduledSms)
    .set({
      status: "failed",
      error: `Not sent: this was held for the ${SMS_WINDOW_LABEL} delivery window and more than ${STALE_AFTER_HOURS} hours passed before it could go out, so it was no longer the message you wrote. Nothing was charged.`,
    })
    .where(
      and(eq(scheduledSms.status, "queued"), lte(scheduledSms.sendAfter, staleBefore)),
    )
    .returning({ id: scheduledSms.id });

  /*
   * Recover rows a restart left behind.
   *
   * A deploy, a memory restart or a crash between the claim and the last
   * update left a row in "sending" for ever: nothing read that status, so the
   * message was neither sent nor reported, and the church could neither see
   * nor cancel it. It is marked failed - NOT requeued, because the gateway may
   * already have delivered some of it, and sending it again would text those
   * people twice.
   */
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const stuck = await db
    .update(scheduledSms)
    .set({
      status: "failed",
      error:
        "Interrupted while sending: some or all of these may have gone out. Check the SMS history and the wallet before sending it again.",
    })
    .where(
      and(eq(scheduledSms.status, "sending"), lte(scheduledSms.sendAfter, stuckBefore)),
    )
    .returning({ id: scheduledSms.id });

  const due: DueRow[] = await db
    .select(dueColumns)
    .from(scheduledSms)
    .innerJoin(church, eq(church.id, scheduledSms.churchId))
    .where(and(eq(scheduledSms.status, "queued"), lte(scheduledSms.sendAfter, now)))
    .orderBy(asc(scheduledSms.sendAfter))
    .limit(50);

  const report: FlushReport = {
    considered: due.length,
    sent: 0,
    held: 0,
    failed: 0,
    expired: expired.length,
    stuck: stuck.length,
  };

  for (const row of due) {
    const outcome = await processRow(row, now);
    if (outcome === "sent") report.sent++;
    else if (outcome === "held") report.held++;
    else if (outcome === "failed") report.failed++;
  }

  return report;
}

/**
 * Send one queued row now - the composer's background send, started from
 * `after()` once the person has been told it is going.
 *
 * Goes through the same claim as the cron, so if the cron reaches the row
 * first this does nothing, and the other way round. If the process dies before
 * this runs, the row is still "queued" and due, and the next cron pass sends it.
 */
export async function sendQueuedSmsNow(
  id: string,
): Promise<"sent" | "held" | "failed" | "claimed-elsewhere"> {
  const [row] = await db
    .select(dueColumns)
    .from(scheduledSms)
    .innerJoin(church, eq(church.id, scheduledSms.churchId))
    .where(and(eq(scheduledSms.id, id), eq(scheduledSms.status, "queued")))
    .limit(1);
  if (!row) return "claimed-elsewhere";
  return processRow(row, new Date());
}

async function processRow(
  row: DueRow,
  now: Date,
): Promise<"sent" | "held" | "failed" | "claimed-elsewhere"> {
  /*
   * Due, but is it allowed yet?
   *
   * `sendAfter` is when the window opened; this asks whether it is still
   * open. A row whose send failed all evening, or one written before a church
   * changed its timezone, must not be pushed out at 9pm just because its
   * timestamp has passed. It is moved to the next morning instead.
   */
  if (!withinSmsWindow(now, row.timezone)) {
    const next = nextSmsWindowStart(now, row.timezone);
    await db
      .update(scheduledSms)
      .set({ sendAfter: next })
      .where(and(eq(scheduledSms.id, row.id), eq(scheduledSms.status, "queued")));
    return "held";
  }

  // Claim it. The status condition is what makes this safe to run twice.
  // `sendAfter` becomes the claim time, which is what the stuck-row recovery
  // above measures from - no extra column needed.
  const claimed = await db
    .update(scheduledSms)
    .set({ status: "sending", attempts: row.attempts + 1, sendAfter: now })
    .where(and(eq(scheduledSms.id, row.id), eq(scheduledSms.status, "queued")))
    .returning({ id: scheduledSms.id });
  if (claimed.length === 0) return "claimed-elsewhere";

  try {
    return await sendClaimedRow(row, now);
  } catch (e) {
    /*
     * Anything that throws after the claim - the wallet, the usage meter, the
     * history insert - used to abort the whole pass and strand this row in
     * "sending". Now it fails this row with a reason and the pass carries on.
     * Not requeued: the gateway may already have taken some of it.
     */
    console.error(`[sms-queue] row ${row.id} (church ${row.churchId}) threw while sending:`, e);
    await db
      .update(scheduledSms)
      .set({
        status: "failed",
        error:
          "Sending stopped on an internal error: some messages may have gone out. Check the SMS history and the wallet before sending it again.",
      })
      .where(and(eq(scheduledSms.id, row.id), eq(scheduledSms.status, "sending")));
    return "failed";
  }
}

async function sendClaimedRow(
  row: DueRow,
  now: Date,
): Promise<"sent" | "failed"> {
  const attempts = row.attempts + 1;
  const recipients = row.recipients ?? [];
  if (recipients.length === 0) {
    await db
      .update(scheduledSms)
      .set({ status: "failed", error: "Nobody left to send to." })
      .where(eq(scheduledSms.id, row.id));
    return "failed";
  }

  const { sendChurchSmsBatch } = await import("@/lib/church-sms");
  const res = await sendChurchSmsBatch({
    churchId: row.churchId,
    recipients: recipients.map((r) => ({ phone: r.phone, message: r.message })),
    userId: row.createdBy ?? undefined,
    label: row.reason ?? row.audience,
    // Already checked above, and checking again here would be the one way
    // this worker could queue the thing it is trying to send.
    timing: "now",
  });

  if (res.ok !== true) {
    const error =
      res.ok === "queued"
        ? "The window closed while this was sending."
        : res.error;
    /*
     * A failure is usually "not enough balance" or "sender ID not approved",
     * and both are things a church fixes and then wants the message to go.
     * So it goes back in the queue until the attempts run out, and only then
     * is it marked failed — with the reason, where somebody can read it.
     */
    await db
      .update(scheduledSms)
      .set(
        attempts >= MAX_SMS_ATTEMPTS
          ? { status: "failed", error }
          : {
              status: "queued",
              error,
              sendAfter: new Date(now.getTime() + RETRY_AFTER_MS),
            },
      )
      .where(eq(scheduledSms.id, row.id));
    return "failed";
  }

  const verdict = queueVerdict({
    sent: res.sent,
    failed: res.failed,
    unconfirmed: res.unconfirmed,
    recipients: recipients.length,
    attempts,
    firstError: res.outcomes.find((o) => o.status === "failed")?.error ?? null,
  });

  /*
   * The composer's send gets its communication_log row when the attempt is
   * final - it went, in full or in part, or it is out of retries - so the
   * history records what actually happened: the real counts, the real cost,
   * at the real time. A row going back for another try writes nothing yet.
   *
   * Birthday greetings too: one that waited for 08:00 and then went must be
   * as visible as one that went at once, or the church sends it again by
   * hand. Their text is the church's own template filled with a name, so it
   * carries no link and is safe to show. Other automatic senders stay out
   * until somebody has checked theirs the same way.
   */
  let logId: string | null = null;
  if ((row.origin === "communication" || row.origin === "celebrations") && !verdict.retry) {
    const byPhone = new Map(recipients.map((r) => [r.phone, r]));
    const outcomes: RecipientOutcome[] = res.outcomes.map((o) => {
      const person = byPhone.get(o.phone);
      return {
        memberId: person?.memberId ?? null,
        name: person?.name ?? null,
        destination: o.phone,
        status: o.status,
        error: o.error ?? null,
        providerMessageId: o.providerMessageId ?? null,
      };
    });
    const [log] = await db
      .insert(communicationLog)
      .values({
        churchId: row.churchId,
        channel: "sms",
        audience: row.audience,
        body: row.body,
        recipients: recipients.length,
        sent: res.sent,
        failed: res.failed,
        skipped: res.skipped,
        units: res.pages,
        cost: res.cost,
        createdBy: row.createdBy ?? undefined,
      })
      .returning({ id: communicationLog.id });
    logId = log?.id ?? null;
    if (log) await recordRecipients(log.id, row.churchId, outcomes);
  }

  if (verdict.status === "queued") {
    await db
      .update(scheduledSms)
      .set({
        status: "queued",
        error: verdict.error,
        sendAfter: new Date(now.getTime() + RETRY_AFTER_MS),
      })
      .where(eq(scheduledSms.id, row.id));
    console.warn(
      `[sms-queue] row ${row.id} (church ${row.churchId}): the gateway refused all ${res.failed}; retrying in 30 minutes (attempt ${attempts} of ${MAX_SMS_ATTEMPTS})`,
    );
    return "failed";
  }

  if (verdict.status === "failed") {
    await db
      .update(scheduledSms)
      .set({ status: "failed", error: verdict.error, logId })
      .where(eq(scheduledSms.id, row.id));
    console.error(
      `[sms-queue] row ${row.id} (church ${row.churchId}) failed for good: ${verdict.error}`,
    );
    return "failed";
  }

  await db
    .update(scheduledSms)
    .set({ status: "sent", sentAt: new Date(), error: verdict.error, logId })
    .where(eq(scheduledSms.id, row.id));
  return "sent";
}
