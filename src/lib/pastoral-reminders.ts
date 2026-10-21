import "server-only";
import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { church, pastoralAppointment } from "@/db/schema";
import { automationPaused, standingColumns } from "@/lib/church-standing";
import { anyDelivered } from "@/lib/pastoral-shared";
import { sendReminder } from "@/lib/pastoral-notify";

/**
 * The reminder sweep, every five minutes.
 *
 * `remind_at` was worked out when the appointment was confirmed, already
 * moved inside the 8am-8pm text window (remindAtFor), so this only has to
 * find what is due. Each reminder is CLAIMED before it is sent, by a
 * conditional UPDATE of reminder_sent_at that returns the row, so two workers
 * (PM2 runs two) or an overlapping tick can never send one twice.
 *
 * A church that has dropped below Growth still gets reminders for what it
 * already promised: a reminder is not a new church write, and the person was
 * told they were booked. A church whose automations are paused (lapsed trial,
 * no plan) is skipped and counted.
 *
 * The summary's keys avoid the words cron-meta strips (email, phone, member,
 * user, address, token), so the run log keeps them.
 */

export type PastoralReminderSummary = {
  churches: number;
  due: number;
  reminded: number;
  failed: number;
  skippedPaused: number;
};

const BATCH = 200;

export async function runPastoralReminders(now: Date = new Date()): Promise<PastoralReminderSummary> {
  // Joined to church, so drizzle qualifies every column: no raw-sql trap here.
  const due = await db
    .select({
      id: pastoralAppointment.id,
      churchId: pastoralAppointment.churchId,
      ...standingColumns,
    })
    .from(pastoralAppointment)
    .innerJoin(church, eq(church.id, pastoralAppointment.churchId))
    .where(
      and(
        eq(pastoralAppointment.status, "confirmed"),
        isNull(pastoralAppointment.reminderSentAt),
        lte(pastoralAppointment.remindAt, now),
        gt(pastoralAppointment.startsAt, now),
      ),
    )
    .orderBy(asc(pastoralAppointment.remindAt))
    .limit(BATCH);

  const summary: PastoralReminderSummary = {
    churches: new Set(due.map((d) => d.churchId)).size,
    due: due.length,
    reminded: 0,
    failed: 0,
    skippedPaused: 0,
  };

  for (const row of due) {
    if (automationPaused(row, now)) {
      summary.skippedPaused++;
      continue;
    }

    const claimed = await db
      .update(pastoralAppointment)
      .set({ reminderSentAt: now })
      .where(
        and(
          eq(pastoralAppointment.id, row.id),
          isNull(pastoralAppointment.reminderSentAt),
          eq(pastoralAppointment.status, "confirmed"),
        ),
      )
      .returning({ id: pastoralAppointment.id });
    // Zero rows: another worker has it, or it was cancelled a moment ago.
    if (claimed.length !== 1) continue;

    const outcome = await sendReminder(row.churchId, row.id, now);
    if (anyDelivered(outcome)) summary.reminded++;
    else if (outcome) summary.failed++;
  }

  return summary;
}
