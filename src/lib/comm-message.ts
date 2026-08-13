import "server-only";
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communicationLog, communicationRecipient, user } from "@/db/schema";
import {
  RECIPIENT_PAGE_SIZE,
  type MessageFilters,
  type RecipientStatusFilter,
} from "@/lib/comm-message-shared";

/* ============================================================
 * One sent message and who it actually reached.
 *
 * communication_log carries the totals ("117 of 120 delivered");
 * communication_recipient carries the per-person detail that answers the
 * question the totals raise: which three didn't, and why.
 *
 * The filter vocabulary lives in comm-message-shared.ts so client components
 * can use it without pulling the database in.
 * ========================================================== */

/** Which stored statuses each tab covers. */
const STATUS_GROUPS: Record<
  Exclude<RecipientStatusFilter, "all">,
  ("skipped" | "failed" | "sent" | "delivered" | "undelivered")[]
> = {
  // Confirmed by the network, versus merely handed to the gateway. Kept apart
  // now that delivery reports tell us the difference.
  delivered: ["delivered"],
  failed: ["failed", "undelivered"],
  sent: ["sent"],
  skipped: ["skipped"],
};

/** The message itself, or null if there's no such message for this church.
 *  A malformed id is simply "not found" — Postgres would otherwise reject the
 *  uuid cast and turn a stale link into a server error. */
export async function getMessage(churchId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: communicationLog.id,
      channel: communicationLog.channel,
      audience: communicationLog.audience,
      subject: communicationLog.subject,
      body: communicationLog.body,
      recipients: communicationLog.recipients,
      sent: communicationLog.sent,
      failed: communicationLog.failed,
      skipped: communicationLog.skipped,
      units: communicationLog.units,
      cost: communicationLog.cost,
      createdAt: communicationLog.createdAt,
      sentBy: user.name,
    })
    .from(communicationLog)
    .leftJoin(user, eq(user.id, communicationLog.createdBy))
    .where(and(eq(communicationLog.id, id), eq(communicationLog.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

function recipientWhere(logId: string, f: MessageFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(communicationRecipient.logId, logId)];
  if (f.status !== "all")
    parts.push(inArray(communicationRecipient.status, STATUS_GROUPS[f.status]));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    parts.push(
      or(
        ilike(communicationRecipient.name, like),
        ilike(communicationRecipient.destination, like),
      ),
    );
  }
  return and(...parts);
}

/** One page of recipients, newest-first by name, plus the matching count. */
export async function getRecipients(logId: string, f: MessageFilters) {
  const where = recipientWhere(logId, f);
  const [rows, [agg]] = await Promise.all([
    db
      .select({
        id: communicationRecipient.id,
        memberId: communicationRecipient.memberId,
        name: communicationRecipient.name,
        destination: communicationRecipient.destination,
        status: communicationRecipient.status,
        error: communicationRecipient.error,
      })
      .from(communicationRecipient)
      .where(where)
      // Problems first — that's what someone opening this screen came for.
      .orderBy(
        sql`case ${communicationRecipient.status}
              when 'failed' then 0
              when 'undelivered' then 0
              when 'skipped' then 1
              else 2 end`,
        asc(communicationRecipient.name),
      )
      .limit(RECIPIENT_PAGE_SIZE)
      .offset((f.page - 1) * RECIPIENT_PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(communicationRecipient)
      .where(where),
  ]);
  return { rows, count: Number(agg?.count ?? 0) };
}

/** Per-status totals for this message, straight from the recipient rows. */
export async function getRecipientTotals(logId: string) {
  const rows = await db
    .select({
      status: communicationRecipient.status,
      count: sql<number>`count(*)::int`,
    })
    .from(communicationRecipient)
    .where(eq(communicationRecipient.logId, logId))
    .groupBy(communicationRecipient.status);

  // `sent` counts only those still awaiting a delivery report; `delivered` is
  // network-confirmed. Splitting them is the whole point of delivery reports.
  const totals = { sent: 0, delivered: 0, failed: 0, skipped: 0, all: 0 };
  for (const r of rows) {
    const n = Number(r.count);
    totals.all += n;
    if (r.status === "skipped") totals.skipped += n;
    else if (r.status === "failed" || r.status === "undelivered")
      totals.failed += n;
    else if (r.status === "delivered") totals.delivered += n;
    else totals.sent += n;
  }
  return totals;
}

export const RECIPIENT_CSV_HEADERS = [
  "Name",
  "Sent to",
  "Status",
  "Reason",
] as const;

const STATUS_LABEL: Record<string, string> = {
  sent: "Delivered",
  delivered: "Delivered",
  failed: "Not delivered",
  undelivered: "Not delivered",
  skipped: "Skipped",
};

/** Every recipient matching the filters, for the CSV download. */
export async function getRecipientExportRows(
  logId: string,
  f: MessageFilters,
): Promise<string[][]> {
  const rows = await db
    .select({
      name: communicationRecipient.name,
      destination: communicationRecipient.destination,
      status: communicationRecipient.status,
      error: communicationRecipient.error,
    })
    .from(communicationRecipient)
    .where(recipientWhere(logId, f))
    .orderBy(asc(communicationRecipient.name));

  return rows.map((r) => [
    r.name ?? "",
    r.destination ?? "",
    STATUS_LABEL[r.status] ?? r.status,
    r.error ?? "",
  ]);
}
