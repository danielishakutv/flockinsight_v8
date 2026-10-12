/**
 * What the SMS queue worker does with a row once the gateway has answered.
 * Pure, so the rule can be tested without a database or a gateway.
 *
 * WHY THIS IS ITS OWN DECISION. The batch sender says `ok: true` whenever it
 * got as far as the gateway - including when the gateway then refused every
 * single message (the platform's Termii float ran out, a 5xx, a sender ID
 * revoked on Termii's side). The worker only looked at `ok`, so those rows
 * were marked "sent" with no error and vanished from the queue view: the 8am
 * birthday and reminder texts reported as gone, and silently lost.
 */

/** How many attempts a row gets before it stops being retried. */
export const MAX_SMS_ATTEMPTS = 3;

/** How long a failed-everything row waits before its next attempt. */
export const RETRY_AFTER_MS = 30 * 60_000;

export type QueueVerdict =
  /** Nothing went and nothing was charged: safe to try the whole row again. */
  | { status: "queued"; error: string; retry: true }
  /** Out of attempts, or nothing to retry. */
  | { status: "failed"; error: string; retry: false }
  /** Went - in full (`error` null) or in part (`error` says who did not get it). */
  | { status: "sent"; error: string | null; retry: false };

export function queueVerdict(opts: {
  /** Confirmed by the gateway. */
  sent: number;
  failed: number;
  /**
   * Neither confirmed nor refused: a timeout, a lost answer. They may have
   * gone, so they are charged and their row is NEVER retried - retrying a
   * timed-out bulk call is how one 8am notice reached a congregation three
   * times. Optional only for callers that predate it; absent means none.
   */
  unconfirmed?: number;
  /** How many numbers the row was for, unusable ones included. */
  recipients: number;
  /** Attempts made so far, this one included. */
  attempts: number;
  /** The first gateway error, in its own words. */
  firstError?: string | null;
}): QueueVerdict {
  const reason = opts.firstError?.trim() || "The SMS gateway refused every message.";
  const unconfirmed = opts.unconfirmed ?? 0;
  const unconfirmedNote =
    unconfirmed > 0
      ? `The gateway did not confirm ${unconfirmed} of ${opts.recipients}; they may have gone, so they were charged and not retried. Check the delivery report before sending again.`
      : null;

  if (opts.sent === 0 && unconfirmed === 0 && opts.failed > 0) {
    // Retrying is safe ONLY here: every call was refused outright, so nobody
    // received anything and the hold was refunded in full - a second attempt
    // cannot text or charge anyone twice.
    const error = `Not sent: ${reason} Nothing was charged.`;
    return opts.attempts >= MAX_SMS_ATTEMPTS
      ? { status: "failed", error, retry: false }
      : { status: "queued", error, retry: true };
  }

  if (opts.sent === 0 && unconfirmed > 0) {
    // Nothing confirmed, but some of it may have gone. Not a send to report
    // as done, and not one to try again.
    return {
      status: "failed",
      error: `${unconfirmedNote}${opts.failed > 0 ? ` ${opts.failed} more were refused: ${reason}` : ""}`,
      retry: false,
    };
  }

  if (opts.sent === 0) {
    // Every number was unusable - there is nothing a retry could change.
    return {
      status: "failed",
      error: "Not sent: none of these phone numbers could be used. Nothing was charged.",
      retry: false,
    };
  }

  /*
   * Some went. Never requeue: the row is the whole list, so a retry would text
   * and charge again everybody who already got it. Marked sent, with the
   * shortfall written down where the church can see it.
   */
  const missed = opts.recipients - opts.sent - unconfirmed;
  const parts: string[] = [];
  if (missed > 0)
    parts.push(
      `${missed} of ${opts.recipients} could not be sent${opts.failed > 0 ? `: ${reason}` : " (unusable numbers)"}. Only the ones that went were charged.`,
    );
  if (unconfirmedNote) parts.push(unconfirmedNote);
  return {
    status: "sent",
    error: parts.length ? parts.join(" ") : null,
    retry: false,
  };
}
