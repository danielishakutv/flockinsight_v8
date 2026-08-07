import "server-only";
import { db } from "@/db";
import { communicationRecipient } from "@/db/schema";

/** One person's outcome for a single send, ready to be written to the log. */
export type RecipientOutcome = {
  memberId: string | null;
  name: string | null;
  /** Phone number or email address used; null when there wasn't one. */
  destination: string | null;
  status: "skipped" | "failed" | "sent" | "delivered" | "undelivered";
  error?: string | null;
  providerMessageId?: string | null;
};

/** Postgres caps a statement at 65535 bind parameters; this table binds 8 per
 *  row, so chunk well under that for very large sends. */
const CHUNK = 500;

/**
 * Record who a message actually reached. Best-effort: a failure to write the
 * per-recipient detail must never fail a send that already went out, so
 * problems are logged and swallowed.
 */
export async function recordRecipients(
  logId: string,
  churchId: string,
  outcomes: RecipientOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  try {
    for (let i = 0; i < outcomes.length; i += CHUNK) {
      const chunk = outcomes.slice(i, i + CHUNK).map((o) => ({
        logId,
        churchId,
        // Hand-typed contacts use a synthetic "contact:…" id that is not a
        // real member — never store it as a foreign key.
        memberId: o.memberId,
        name: o.name || null,
        destination: o.destination,
        status: o.status,
        error: o.error ?? null,
        providerMessageId: o.providerMessageId ?? null,
      }));
      await db.insert(communicationRecipient).values(chunk);
    }
  } catch (e) {
    console.error("[comm] could not record per-recipient results:", e);
  }
}

/** Counts that must reconcile with the recipient rows we just wrote. */
export function tally(outcomes: RecipientOutcome[]) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o.status === "skipped") skipped++;
    else if (o.status === "failed" || o.status === "undelivered") failed++;
    else sent++;
  }
  return { recipients: outcomes.length, sent, failed, skipped };
}
