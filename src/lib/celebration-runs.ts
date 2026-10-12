/**
 * When the celebrations cron may (re)send one greeting on one channel.
 *
 * Pure, so the rule can be tested without a database. The cron reads the
 * celebration_run rows for today, asks this what to do with each, and then
 * makes the write conditional on the state it read — so two overlapping runs
 * can never both claim the same greeting.
 *
 * The cron runs hourly and a church's send window is two and a half hours, so
 * a failure gets up to three attempts on the day: enough for "the wallet was
 * empty at 8, topped up by 9", without retrying a church that never fixes it
 * every hour for ever.
 */

export const CELEBRATION_MAX_ATTEMPTS = 3;

/**
 * A "pending" row older than this belongs to a run that died mid-send (a
 * deploy, a crash). Younger, it is another run's send in flight — leave it.
 */
export const PENDING_STALE_MS = 30 * 60_000;

/** What a stale SMS claim is settled with, in the words the church is shown. */
export const SMS_INTERRUPTED_DETAIL =
  "Interrupted mid-send; it may have gone, so it was not sent again.";

export type RunState = {
  outcome: string;
  attempts: number;
  updatedAt: Date | string;
};

/**
 * - `insert`: nothing yet today; claim a new row.
 * - `reclaim`: a failure (or a dead email claim) with attempts left; send again.
 * - `abandon`: a dead SMS claim; settle it as failed and send nothing.
 * - `leave`: somebody else's, or finished.
 */
export type ClaimDecision = "insert" | "reclaim" | "abandon" | "leave";

export function claimDecision(
  existing: RunState | undefined,
  now: Date,
  channel: "sms" | "email",
): ClaimDecision {
  if (!existing) return "insert";
  // Delivered, or handed to the 8am–8pm queue, which owns it from there.
  if (existing.outcome === "sent" || existing.outcome === "queued") return "leave";
  if (existing.attempts >= CELEBRATION_MAX_ATTEMPTS) return "leave";
  if (existing.outcome === "pending") {
    const age = now.getTime() - new Date(existing.updatedAt).getTime();
    if (age < PENDING_STALE_MS) return "leave";
    /*
     * A dead SMS claim may well have been sent — and charged — before the
     * process died: the row is written "pending" first and settled only once
     * the gateway answers. Sending it again would text the member twice and
     * charge the church twice, which is the same reason a batch that throws is
     * final. So it is settled, not retried. An email costs nothing and a
     * second one is harmless, so a dead email claim is still retried.
     */
    if (channel === "sms") return "abandon";
  }
  return "reclaim";
}

/**
 * Match the gateway's per-number outcomes back to the greetings that produced
 * them.
 *
 * One phone can carry several greetings — a parent receiving two children's
 * birthdays, a couple sharing a number on their anniversary — and the batch
 * reports each message separately but by phone only. So they are consumed one
 * per message, in order, never looked up: a lookup would settle both of a
 * household's greetings with whichever verdict came first. Anything the
 * gateway never reported on is returned in `unreported`, so it is recorded as
 * failed rather than left "pending", which would read as "in flight".
 */
export function matchSmsOutcomes<J extends { phone: string }>(
  jobs: J[],
  outcomes: { phone: string; status: "sent" | "failed" | "skipped"; error?: string }[],
): {
  settled: { job: J; ok: boolean; error: string | null }[];
  unreported: J[];
} {
  const pending = new Map<string, J[]>();
  for (const j of jobs) pending.set(j.phone, [...(pending.get(j.phone) ?? []), j]);
  const settled: { job: J; ok: boolean; error: string | null }[] = [];
  for (const o of outcomes) {
    const job = pending.get(o.phone)?.shift();
    if (!job) continue; // An outcome for a number this run did not send to.
    settled.push(
      o.status === "sent"
        ? { job, ok: true, error: null }
        : { job, ok: false, error: o.error ?? `The number was ${o.status}.` },
    );
  }
  return { settled, unreported: [...pending.values()].flat() };
}

/**
 * The start of `detail` on a greeting whose whole SMS batch the gateway
 * refused — no balance, no approved sender ID. Readable to the church, and
 * what tells "the managers were already told this week" apart from one
 * member's bad number in a batch that otherwise went.
 */
export const SMS_BATCH_REFUSED = "The whole SMS send was refused: ";

/**
 * What the managers should do about a refused batch, chosen from the reason.
 *
 * The notice used to say "Top up in Settings → Wallet" whatever the reason
 * was, so a church whose sender ID was unapproved was sent to its wallet, and
 * one whose members' numbers were unusable was told to spend money on it.
 */
export function smsRefusalAdvice(error: string): string {
  if (/balance|insufficient/i.test(error))
    return "Top up in Settings → Wallet, or turn SMS off for celebrations.";
  if (/sender id/i.test(error))
    return "Your SMS sender ID has to be approved first: see Settings → SMS, or turn SMS off for celebrations.";
  if (/no valid phone/i.test(error))
    return "None of those members has a phone number we can text. Check the numbers on their member records.";
  if (/available in your country/i.test(error))
    return "Turn SMS off for celebrations; email greetings still go.";
  return "Check Settings → SMS, or turn SMS off for celebrations.";
}
