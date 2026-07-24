import "server-only";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "@/db";
import { communicationLog, user } from "@/db/schema";
import {
  PAGE_SIZE,
  bucketUnit,
  rangeStart,
  type HistoryFilters,
} from "@/lib/comm-history-shared";

/* ============================================================
 * Sent message history & analytics — the query layer behind the
 * /communication/history page and its CSV export, so both read the same
 * filters the same way. Filter vocabulary lives in comm-history-shared.ts.
 * ========================================================== */

function whereFor(churchId: string, f: HistoryFilters) {
  const parts = [eq(communicationLog.churchId, churchId)];
  if (f.channel !== "all")
    parts.push(eq(communicationLog.channel, f.channel));
  const start = rangeStart(f.range);
  if (start) parts.push(gte(communicationLog.createdAt, start));
  if (f.q) {
    const like = `%${f.q}%`;
    const match = or(
      ilike(communicationLog.body, like),
      ilike(communicationLog.subject, like),
      ilike(communicationLog.audience, like),
    );
    if (match) parts.push(match);
  }
  return and(...parts);
}

export type HistorySummary = {
  messages: number;
  recipients: number;
  sent: number;
  failed: number;
  units: number;
  cost: number;
};

export type ChannelSummary = HistorySummary & { channel: string };

/** Totals across everything matching the filters. */
export async function getHistorySummary(
  churchId: string,
  f: HistoryFilters,
): Promise<{ total: HistorySummary; byChannel: ChannelSummary[] }> {
  const cols = {
    messages: sql<number>`count(*)`,
    recipients: sql<number>`coalesce(sum(${communicationLog.recipients}), 0)`,
    sent: sql<number>`coalesce(sum(${communicationLog.sent}), 0)`,
    failed: sql<number>`coalesce(sum(${communicationLog.failed}), 0)`,
    units: sql<number>`coalesce(sum(${communicationLog.units}), 0)`,
    cost: sql<number>`coalesce(sum(${communicationLog.cost}), 0)`,
  };

  const [totals, perChannel] = await Promise.all([
    db.select(cols).from(communicationLog).where(whereFor(churchId, f)),
    db
      .select({ channel: communicationLog.channel, ...cols })
      .from(communicationLog)
      .where(whereFor(churchId, f))
      .groupBy(communicationLog.channel),
  ]);

  const num = (r: Record<string, unknown>): HistorySummary => ({
    messages: Number(r.messages ?? 0),
    recipients: Number(r.recipients ?? 0),
    sent: Number(r.sent ?? 0),
    failed: Number(r.failed ?? 0),
    units: Number(r.units ?? 0),
    cost: Number(r.cost ?? 0),
  });

  return {
    total: num(totals[0] ?? {}),
    byChannel: perChannel.map((r) => ({ channel: r.channel, ...num(r) })),
  };
}

export type ActivityPoint = { label: string; sent: number; failed: number };

/**
 * Sent-vs-failed over time. The bucket widens with the range so the chart
 * stays readable: days for a month or less, weeks up to a year, then months.
 */
export async function getHistoryActivity(
  churchId: string,
  f: HistoryFilters,
): Promise<{ points: ActivityPoint[]; unit: "day" | "week" | "month" }> {
  const unit = bucketUnit(f.range);
  // The unit is inlined rather than bound: Postgres matches GROUP BY against
  // the SELECT expression by shape, and a bind param lands under a different
  // number in each clause, so the grouping wouldn't match. `unit` is one of
  // three fixed literals, never user input.
  const bucket = sql<string>`date_trunc(${sql.raw(`'${unit}'`)}, ${communicationLog.createdAt})`;
  const rows = await db
    .select({
      bucket,
      sent: sql<number>`coalesce(sum(${communicationLog.sent}), 0)`,
      failed: sql<number>`coalesce(sum(${communicationLog.failed}), 0)`,
    })
    .from(communicationLog)
    .where(whereFor(churchId, f))
    .groupBy(bucket)
    .orderBy(bucket);

  const pattern = unit === "month" ? "MMM yy" : "MMM d";
  return {
    unit,
    points: rows.map((r) => ({
      label: format(new Date(r.bucket), pattern),
      sent: Number(r.sent),
      failed: Number(r.failed),
    })),
  };
}

export type HistoryRow = {
  id: string;
  channel: "sms" | "email" | "notification";
  audience: string;
  subject: string | null;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  units: number;
  cost: number;
  sentBy: string | null;
  createdAt: string;
};

const rowCols = {
  id: communicationLog.id,
  channel: communicationLog.channel,
  audience: communicationLog.audience,
  subject: communicationLog.subject,
  body: communicationLog.body,
  recipients: communicationLog.recipients,
  sent: communicationLog.sent,
  failed: communicationLog.failed,
  units: communicationLog.units,
  cost: communicationLog.cost,
  sentBy: user.name,
  createdAt: communicationLog.createdAt,
};

type RawRow = {
  id: string;
  channel: "sms" | "email" | "notification";
  audience: string;
  subject: string | null;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  units: number;
  cost: number;
  sentBy: string | null;
  createdAt: Date;
};

function toRow(r: RawRow): HistoryRow {
  return { ...r, cost: Number(r.cost), createdAt: r.createdAt.toISOString() };
}

/** One page of the log, newest first, plus the total match count. */
export async function getHistoryPage(
  churchId: string,
  f: HistoryFilters,
): Promise<{ rows: HistoryRow[]; total: number; pages: number }> {
  const where = whereFor(churchId, f);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(rowCols)
      .from(communicationLog)
      .leftJoin(user, eq(user.id, communicationLog.createdBy))
      .where(where)
      .orderBy(desc(communicationLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)` })
      .from(communicationLog)
      .where(where),
  ]);
  const total = Number(totalRow?.total ?? 0);
  return {
    rows: rows.map(toRow),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export const HISTORY_CSV_HEADERS = [
  "Sent at",
  "Channel",
  "Audience",
  "Subject",
  "Message",
  "Recipients",
  "Sent",
  "Failed",
  "SMS units",
  "Cost",
  "Sent by",
] as const;

/** Every matching row (capped), flattened for CSV export. */
export async function getHistoryExportRows(
  churchId: string,
  f: HistoryFilters,
): Promise<(string | number)[][]> {
  const rows = await db
    .select(rowCols)
    .from(communicationLog)
    .leftJoin(user, eq(user.id, communicationLog.createdBy))
    .where(whereFor(churchId, f))
    .orderBy(desc(communicationLog.createdAt))
    .limit(5000);

  return rows.map((raw) => {
    const r = toRow(raw);
    return [
      format(new Date(r.createdAt), "yyyy-MM-dd HH:mm"),
      r.channel === "notification" ? "Staff notice" : r.channel,
      r.audience,
      r.subject ?? "",
      r.body.replace(/\s+/g, " ").trim(),
      r.recipients,
      r.sent,
      r.failed,
      r.units,
      r.cost,
      r.sentBy ?? "",
    ];
  });
}
