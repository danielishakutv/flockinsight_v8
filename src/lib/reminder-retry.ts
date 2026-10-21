/**
 * When a service-reminder or pledge-reminder TEXT that did not go is tried
 * again, and what to say about it.
 *
 * Pure, with no database and no server-only import, so the rule is tested
 * directly instead of inferred from what the crons did at 7:58pm. The sweeps
 * read their run rows, ask this what to do with each, and then make the write
 * conditional on the state they read, so two overlapping sweeps can never both
 * claim the same retry.
 *
 * Before 0.80 a reminder was claimed before it was sent and its row had
 * nowhere to keep an outcome, so a text refused for an empty wallet at 8 was
 * simply lost, even if somebody topped up at 8:15. Now a text is tried again
 * only when the previous attempt verifiably sent nothing and the cause could
 * clear within the hour. Email is recorded but never retried: retrying a
 * channel that partly went would send the same message twice.
 *
 * The spacing and the dead-claim rules are celebrations' (celebration-runs.ts),
 * which already run in production.
 */
import {
  RETRY_AFTER_MS,
  SMS_BATCH_REFUSED,
  SMS_INTERRUPTED_DETAIL,
  churchCanClearSmsRefusal,
  claimDecision,
  gatewayRefusedEveryNumber,
} from "@/lib/celebration-runs";
import {
  localMinutesOfDay,
  minutesFromHHMM,
  smsWindowShutForToday,
  withinSmsWindow,
} from "@/lib/sms-window";
// Type-only, so the server-only sender is erased at compile time and never
// loaded by a unit test.
import type { BatchSmsResult, ChurchSmsResult } from "@/lib/church-sms";

/**
 * The first attempt plus two retries. The database holds the same number in a
 * CHECK (sms_attempts between 0 and 3), and a test reads schema.ts to keep the
 * two from drifting apart.
 */
export const REMINDER_SMS_MAX_ATTEMPTS = 3;

/**
 * How long after a church's configured time the service-reminder sweep may
 * still fire, so a missed sweep or two is caught up but nothing goes hours
 * late. Here rather than in service-reminders.ts so a test can pin that the
 * three attempts (T, T+60, T+120) all fit inside it.
 */
export const SEND_WINDOW_MIN = 150;

/** A retry this close to the service start would arrive as people sit down. */
export const RETRY_STOPS_BEFORE_START_MIN = 30;

/**
 * One sweep's worth of lateness. The sweep runs every five minutes, so a retry
 * due at 9:00 may in fact run at 9:05; a prediction made at settle time must
 * allow for that or it will promise a retry the window then refuses.
 */
export const SWEEP_SLACK_MS = 5 * 60_000;

export { RETRY_AFTER_MS };

export type SmsVerdict =
  | { outcome: "sent"; detail: string | null }
  | { outcome: "queued"; detail: string }
  | { outcome: "skipped"; detail: string }
  | { outcome: "failed"; detail: string; retryable: boolean };

export type RetryDecision =
  | { action: "retry"; attempt: number }
  | { action: "leave" }
  | { action: "abandon"; detail: string }
  | { action: "expire"; detail: string };

/** The SMS half of a run row, as the decision functions need it. */
export type SmsRunState = {
  smsOutcome: string | null;
  smsAttempts: number;
  updatedAt: Date | string;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A gateway refusal that is about the number itself, not the moment: it will
 * say the same thing in an hour, so it is never retried.
 */
const NUMBER_REFUSAL = /invalid|not valid|dnd|do not disturb|blacklist|blocked/i;

/**
 * What became of one service's batch of reminder texts (sendChurchSmsBatch).
 *
 * A partial success is final on purpose: sending the batch again would text
 * everybody who already got it, and per-recipient retry state is out of scope.
 * Unconfirmed messages count as gone, as church-sms.ts rules: they were
 * charged and may have arrived.
 */
export function classifyBatchSms(x: { threw: unknown } | BatchSmsResult): SmsVerdict {
  if ("threw" in x) {
    // Our own code failing around the gateway, which may already have sent
    // some of it. Never retried, for the same reason.
    return {
      outcome: "failed",
      detail: `The SMS send stopped on an internal error, so some may have gone: ${errorText(x.threw)}`,
      retryable: false,
    };
  }
  if (x.ok === "queued") return { outcome: "queued", detail: x.notice };
  if (x.ok === false) {
    // Only an empty wallet or a sender ID awaiting approval: both are refused
    // before the wallet hold, so nothing was charged, and a manager can clear
    // either within the hour. A duplicate is already queued elsewhere.
    return {
      outcome: "failed",
      detail: `${SMS_BATCH_REFUSED}${x.error}`,
      retryable: !x.duplicate && churchCanClearSmsRefusal(x.error),
    };
  }
  if (gatewayRefusedEveryNumber(x)) {
    // Nothing went and the hold was refunded in full, typically because the
    // platform's own float ran out, which we can top up within the hour. When
    // every refusal names the number itself (a lone DND number, say), an hour
    // changes nothing, so that batch is final, as a single text would be.
    const refusals = x.outcomes.filter((o) => o.status === "failed");
    const reason = refusals[0]?.error ?? "no reason was given";
    return {
      outcome: "failed",
      detail: `The SMS gateway turned every message away (${reason}), so nothing was charged.`,
      retryable: refusals.some((o) => !NUMBER_REFUSAL.test(o.error ?? "")),
    };
  }
  const notGone = x.failed + x.skipped;
  const total = x.sent + x.unconfirmed + x.failed + x.skipped;
  return {
    outcome: "sent",
    detail:
      notGone > 0
        ? `${notGone} of ${total} did not go; each is in History. Those are not retried.`
        : null,
  };
}

/**
 * What became of one pledge reminder text (sendChurchSms, one number).
 *
 * Retryable only when nothing went and nothing was kept: refused before the
 * wallet hold, a connection that never opened, or a definite gateway refusal
 * (refunded). A refusal that names the number itself (invalid, DND, blocked)
 * will say the same thing in an hour, so it is final.
 */
export function classifySingleSms(x: { threw: unknown } | ChurchSmsResult): SmsVerdict {
  if ("threw" in x) {
    return {
      outcome: "failed",
      detail: `The SMS send stopped on an internal error, so it may have gone: ${errorText(x.threw)}`,
      retryable: false,
    };
  }
  if (x.ok === true) return { outcome: "sent", detail: null };
  if (x.ok === "queued") return { outcome: "queued", detail: x.notice };
  // Kept charged by church-sms.ts because it may well have gone.
  if (x.uncertain) return { outcome: "failed", detail: x.error, retryable: false };
  if (x.duplicate) return { outcome: "failed", detail: x.error, retryable: false };
  if (churchCanClearSmsRefusal(x.error))
    return { outcome: "failed", detail: x.error, retryable: true };
  if (/^Could not reach the SMS gateway/.test(x.error))
    return { outcome: "failed", detail: x.error, retryable: true };
  if (/^SMS not sent:/.test(x.error))
    return { outcome: "failed", detail: x.error, retryable: !NUMBER_REFUSAL.test(x.error) };
  // No valid number, an empty message, SMS not configured or not available in
  // the country, or the delivery-window refusal: none of these clears itself.
  return { outcome: "failed", detail: x.error, retryable: false };
}

/**
 * The church-local date, YYYY-MM-DD. A zone Intl refuses falls back to Lagos,
 * as sms-window.ts does (its safeZone is private), so a bad stored timezone
 * cannot throw out of a sweep.
 */
export function localDateIn(at: Date, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  try {
    return fmt(timeZone || "Africa/Lagos");
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return fmt("Africa/Lagos");
  }
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Steps shared by both reminders: what the row itself says, before any clock
 * rule. Returns null when the row is due a retry and the caller's window rules
 * decide.
 */
function rowDecision(run: SmsRunState, now: Date): RetryDecision | null {
  // null is a row from before 0.80 or a channel not used; skipped had nobody
  // to text. Neither is ever retried.
  if (run.smsOutcome == null || run.smsOutcome === "skipped") return { action: "leave" };
  const d = claimDecision(
    { outcome: run.smsOutcome, attempts: run.smsAttempts, updatedAt: run.updatedAt },
    now,
    "sms",
    REMINDER_SMS_MAX_ATTEMPTS,
  );
  if (d === "abandon") return { action: "abandon", detail: SMS_INTERRUPTED_DETAIL };
  if (d !== "reclaim") return { action: "leave" };
  return null;
}

/**
 * Whether a service reminder's failed text is tried again now.
 *
 * Within its window means: before 8pm church-local, not on a later day than
 * the one it was meant to go, not within 30 minutes of the start, and inside
 * the 150-minute send window after the configured time. `dayBefore` says which
 * day the reminder belongs to, so a day-before reminder is never retried on
 * the service morning.
 */
export function serviceReminderRetry(o: {
  run: SmsRunState;
  now: Date;
  timeZone: string;
  /** YYYY-MM-DD, church-local. */
  serviceDate: string;
  /** "HH:MM", or null when the service has no start time. */
  startTime: string | null;
  /** The church's configured send time, "HH:MM". */
  sendTime: string;
  dayBefore: boolean;
}): RetryDecision {
  const row = rowDecision(o.run, o.now);
  if (row) return row;

  if (smsWindowShutForToday(o.now, o.timeZone))
    return { action: "expire", detail: "Not tried again: texts can't be delivered after 8pm." };
  const today = localDateIn(o.now, o.timeZone);
  if (today > o.serviceDate)
    return { action: "expire", detail: "Not tried again: the service has already happened." };
  const minutes = localMinutesOfDay(o.now, o.timeZone);
  if (today === o.serviceDate && o.startTime) {
    if (minutes >= minutesFromHHMM(o.startTime) - RETRY_STOPS_BEFORE_START_MIN)
      return { action: "expire", detail: "Not tried again: the service starts within 30 minutes." };
  }
  const sendDay = o.dayBefore ? addDays(o.serviceDate, -1) : o.serviceDate;
  const sinceSend = minutes - minutesFromHHMM(o.sendTime);
  if (today !== sendDay || sinceSend < 0 || sinceSend > SEND_WINDOW_MIN)
    return { action: "expire", detail: "Not tried again: the reminder's send window has closed." };
  // Before 8am the window is still to come today.
  if (!withinSmsWindow(o.now, o.timeZone)) return { action: "leave" };
  return { action: "retry", attempt: o.run.smsAttempts + 1 };
}

/**
 * Whether a pledge reminder's failed text is tried again now. Its window is
 * the church-local day it was first tried on, 8am to 8pm; after that it waits
 * for the pledge's next period, as it always did.
 */
export function pledgeReminderRetry(o: {
  run: SmsRunState;
  now: Date;
  timeZone: string;
  /** When the run row was created: the first attempt. */
  claimedAt: Date | string;
}): RetryDecision {
  const row = rowDecision(o.run, o.now);
  if (row) return row;
  if (
    localDateIn(new Date(o.claimedAt), o.timeZone) !== localDateIn(o.now, o.timeZone) ||
    smsWindowShutForToday(o.now, o.timeZone)
  )
    return {
      action: "expire",
      detail: "Not tried again today; it waits for this pledge's next period.",
    };
  if (!withinSmsWindow(o.now, o.timeZone)) return { action: "leave" };
  return { action: "retry", attempt: o.run.smsAttempts + 1 };
}

/** "Reminder: X" for the first attempt, "Reminder: X (attempt 2 of 3)" after. */
export function attemptLabel(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base} (attempt ${attempt} of ${REMINDER_SMS_MAX_ATTEMPTS})`;
}

/**
 * Will this attempt be tried again? Asked at settle time, of the same rule the
 * sweep uses, at the moment the next sweep after the spacing could pick it up.
 * That is what History and the managers' notice say, so they never promise a
 * retry the window will refuse.
 */
export function willRetryAfter(
  decide: (run: SmsRunState, at: Date) => RetryDecision,
  verdict: SmsVerdict,
  attempt: number,
  settledAt: Date,
): boolean {
  if (verdict.outcome !== "failed" || !verdict.retryable) return false;
  if (attempt >= REMINDER_SMS_MAX_ATTEMPTS) return false;
  const at = new Date(settledAt.getTime() + RETRY_AFTER_MS + SWEEP_SLACK_MS);
  return (
    decide({ smsOutcome: "failed", smsAttempts: attempt, updatedAt: settledAt }, at).action ===
    "retry"
  );
}

/** The sentence that tells staff whether to leave it alone. */
export function retryNote(willRetry: boolean): string {
  return willRetry
    ? "It will be tried again automatically in about an hour, so please do not send it again by hand."
    : "It will not be tried again.";
}

/**
 * The per-recipient error written to History for a failed attempt. An admin
 * who reads "failed" and resends by hand while a retry is due texts the whole
 * church twice, so every failure says which it is.
 */
export function historyDetail(verdict: SmsVerdict, willRetry: boolean): string {
  if (verdict.outcome !== "failed") return verdict.detail ?? "";
  return `${verdict.detail} ${retryNote(willRetry)}`;
}
