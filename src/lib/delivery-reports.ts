import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { communicationRecipient, notificationReceipt } from "@/db/schema";
import { shouldApply, type DeliveryState } from "@/lib/delivery-status";

/**
 * Applying provider delivery reports to the per-recipient log.
 *
 * Reports arrive by webhook, out of order, sometimes twice, and sometimes for
 * messages this app never sent (the same Termii account may be used
 * elsewhere). Everything here is idempotent and tolerant of all three.
 */

export type ApplyResult = "updated" | "unchanged" | "unmatched";

/**
 * Find the recipient row a report belongs to.
 *
 * By provider id first. Falling back to the destination is what makes the
 * "Termii returns ids in the order we sent them" assumption safe: if an id
 * never matches, the most recent still-pending row for that number does.
 */
async function findRecipient(opts: {
  providerMessageId?: string | null;
  destination?: string | null;
}): Promise<{ id: string; logId: string; status: string } | null> {
  if (opts.providerMessageId) {
    const [row] = await db
      .select({
        id: communicationRecipient.id,
        logId: communicationRecipient.logId,
        status: communicationRecipient.status,
      })
      .from(communicationRecipient)
      .where(eq(communicationRecipient.providerMessageId, opts.providerMessageId))
      .limit(1);
    if (row) return row;
  }

  if (opts.destination) {
    const [row] = await db
      .select({
        id: communicationRecipient.id,
        logId: communicationRecipient.logId,
        status: communicationRecipient.status,
      })
      .from(communicationRecipient)
      .where(
        and(
          eq(communicationRecipient.destination, opts.destination),
          eq(communicationRecipient.status, "sent"),
        ),
      )
      .orderBy(desc(communicationRecipient.createdAt))
      .limit(1);
    if (row) return row;
  }

  return null;
}

/**
 * Recompute a log's headline counters from its recipient rows.
 *
 * Without this the summary contradicts the detail directly beneath it: the log
 * stores frozen totals taken at send time, and a delivery report that flips a
 * recipient from sent to undelivered would leave "0 failed" sitting above a
 * list of failures.
 */
export async function recomputeLogCounters(logId: string): Promise<void> {
  await db.execute(sql`
    update communication_log l
       set sent = c.sent, failed = c.failed, skipped = c.skipped
      from (
        select
          count(*) filter (where status in ('sent','delivered'))    as sent,
          count(*) filter (where status in ('failed','undelivered')) as failed,
          count(*) filter (where status = 'skipped')                as skipped
        from communication_recipient
        where log_id = ${logId}
      ) as c
     where l.id = ${logId}
  `);
}

/** Apply one provider report. Never throws. */
export async function applyDeliveryReport(opts: {
  providerMessageId?: string | null;
  destination?: string | null;
  state: DeliveryState;
  reason?: string | null;
}): Promise<ApplyResult> {
  try {
    const row = await findRecipient(opts);
    if (!row) return "unmatched";

    // Out-of-order and duplicate reports must not undo a better outcome.
    if (!shouldApply(row.status, opts.state)) return "unchanged";

    await db
      .update(communicationRecipient)
      .set({
        status: opts.state,
        error: opts.reason ?? null,
        // Fill in the id when we matched by destination, so a later report for
        // the same message goes straight to this row.
        ...(opts.providerMessageId
          ? { providerMessageId: opts.providerMessageId }
          : {}),
      })
      .where(eq(communicationRecipient.id, row.id));

    await recomputeLogCounters(row.logId);
    return "updated";
  } catch (e) {
    console.error("[delivery] could not apply report", e);
    return "unmatched";
  }
}

/**
 * Apply a report to a superadmin notification receipt.
 *
 * Separate from the church-side path above, and tried after it: the two live
 * in different tables and a report belongs to exactly one of them. Same rules
 * though — match on the provider's id first, fall back to the address, and
 * never let a late or duplicate report undo a better outcome.
 */
export async function applyNotificationReport(opts: {
  providerMessageId?: string | null;
  destination?: string | null;
  state: DeliveryState;
  reason?: string | null;
}): Promise<ApplyResult> {
  try {
    let row: { id: string; status: string } | undefined;

    if (opts.providerMessageId) {
      [row] = await db
        .select({ id: notificationReceipt.id, status: notificationReceipt.status })
        .from(notificationReceipt)
        .where(
          eq(notificationReceipt.providerMessageId, opts.providerMessageId),
        )
        .limit(1);
    }

    if (!row && opts.destination) {
      // Newest first: the same address may have been emailed many times, and
      // a report almost always concerns the most recent send.
      [row] = await db
        .select({ id: notificationReceipt.id, status: notificationReceipt.status })
        .from(notificationReceipt)
        .where(eq(notificationReceipt.email, opts.destination.toLowerCase()))
        .orderBy(desc(notificationReceipt.createdAt))
        .limit(1);
    }

    if (!row) return "unmatched";
    if (!shouldApply(row.status, opts.state)) return "unchanged";

    await db
      .update(notificationReceipt)
      .set({
        status: opts.state,
        error: opts.reason ?? null,
        updatedAt: new Date(),
        ...(opts.providerMessageId
          ? { providerMessageId: opts.providerMessageId }
          : {}),
      })
      .where(eq(notificationReceipt.id, row.id));

    return "updated";
  } catch (e) {
    console.error("[delivery] could not apply notification report", e);
    return "unmatched";
  }
}
