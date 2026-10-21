import "server-only";
import { db } from "@/db";
import { communicationLog } from "@/db/schema";
import { recordRecipients, tally, type RecipientOutcome } from "@/lib/comm-recipients";

/**
 * Put an automatic reminder in Communication → History, beside what the
 * church sent by hand. Service reminders used to keep this private, and
 * pledge reminders wrote nothing at all, so a pledge text that failed could
 * not be seen to have failed and a retry could not be seen to have happened.
 *
 * Best-effort: failing to write the history must never undo or repeat a
 * reminder that already went. The failure is logged with the sender and the
 * church, so it can be traced.
 */
export async function logReminderToHistory(
  tag: string,
  churchId: string,
  channel: "sms" | "email",
  audience: string,
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
        audience,
        subject: o.subject ?? null,
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
      `[${tag}] reminder could not be written to the history for church ${churchId}:`,
      e,
    );
  }
}
