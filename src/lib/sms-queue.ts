import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  communicationLog,
  scheduledSms,
  user,
} from "@/db/schema";
import { recordRecipients, type RecipientOutcome } from "@/lib/comm-recipients";
import { smsPages } from "@/lib/sms";
import {
  nextSmsWindowStart,
  smsWindowNotice,
  withinSmsWindow,
} from "@/lib/sms-window";

/**
 * SMS that arrived outside the 8am–8pm delivery window, and the worker that
 * sends it when the window opens.
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
  sendAfter: Date;
  count: number;
  notice: string;
};

/** Park a send until the window opens. Returns what the caller tells the user. */
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
}): Promise<QueuedResult> {
  const sendAfter = nextSmsWindowStart(new Date(), opts.timezone);

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
      createdBy: opts.userId ?? null,
    })
    .returning({ id: scheduledSms.id });

  console.log(
    `[sms-queue] held ${opts.recipients.length} message(s) for church ${opts.churchId} until ${sendAfter.toISOString()} (${row?.id})`,
  );

  return {
    ok: "queued",
    sendAfter,
    count: opts.recipients.length,
    notice: smsWindowNotice(sendAfter, opts.timezone),
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

/** What this church has waiting (and what recently failed), newest first. */
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
        // Sent ones are in the communication history, where they belong. This
        // list is only what has not happened yet, plus what went wrong.
        inArray(scheduledSms.status, ["queued", "failed"]),
      ),
    )
    .orderBy(asc(scheduledSms.sendAfter), desc(scheduledSms.createdAt))
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

/** How many attempts a row gets before it stops being retried. */
const MAX_ATTEMPTS = 3;

export type FlushReport = {
  considered: number;
  sent: number;
  held: number;
  failed: number;
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
  const due = await db
    .select({
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
    })
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
  };

  for (const row of due) {
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
        .where(eq(scheduledSms.id, row.id));
      report.held++;
      continue;
    }

    // Claim it. The status condition is what makes this safe to run twice.
    const claimed = await db
      .update(scheduledSms)
      .set({ status: "sending", attempts: row.attempts + 1 })
      .where(and(eq(scheduledSms.id, row.id), eq(scheduledSms.status, "queued")))
      .returning({ id: scheduledSms.id });
    if (claimed.length === 0) continue;

    const recipients = row.recipients ?? [];
    if (recipients.length === 0) {
      await db
        .update(scheduledSms)
        .set({ status: "failed", error: "Nobody left to send to." })
        .where(eq(scheduledSms.id, row.id));
      report.failed++;
      continue;
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
      const attempts = row.attempts + 1;
      /*
       * A failure is usually "not enough balance" or "sender ID not approved",
       * and both are things a church fixes and then wants the message to go.
       * So it goes back in the queue until the attempts run out, and only then
       * is it marked failed — with the reason, where somebody can read it.
       */
      await db
        .update(scheduledSms)
        .set(
          attempts >= MAX_ATTEMPTS
            ? { status: "failed", error }
            : {
                status: "queued",
                error,
                sendAfter: new Date(now.getTime() + 30 * 60_000),
              },
        )
        .where(eq(scheduledSms.id, row.id));
      report.failed++;
      continue;
    }

    /*
     * It went. A send made from the composer gets its communication_log row
     * now rather than when it was queued, so the history records what actually
     * happened — the real counts, the real cost, at the real time.
     */
    let logId: string | null = null;
    if (row.origin === "communication") {
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
          units: smsPages(row.body) * res.sent,
          cost: res.cost,
          createdBy: row.createdBy ?? undefined,
        })
        .returning({ id: communicationLog.id });
      logId = log?.id ?? null;
      if (log) await recordRecipients(log.id, row.churchId, outcomes);
    }

    await db
      .update(scheduledSms)
      .set({ status: "sent", sentAt: new Date(), error: null, logId })
      .where(eq(scheduledSms.id, row.id));
    report.sent++;
  }

  return report;
}
