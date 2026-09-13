"use server";

import { z } from "zod";
import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, notificationReceipt } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";

/**
 * Who a notice went to, and what became of it.
 *
 * Loaded on demand rather than with the history: a send to every church is
 * hundreds of rows, and almost every glance at the history does not need them.
 */

export type ReceiptRow = {
  id: string;
  name: string | null;
  email: string;
  churchName: string | null;
  status: "sent" | "delivered" | "undelivered" | "failed" | "skipped";
  error: string | null;
  createdAt: string;
};

export type ReceiptSummary = {
  total: number;
  delivered: number;
  sent: number;
  undelivered: number;
  failed: number;
  rows: ReceiptRow[];
};

export async function notificationReceipts(
  notificationId: string,
): Promise<
  { ok: true; summary: ReceiptSummary } | { ok: false; error: string }
> {
  await requirePlatform("platform.messaging.send");
  if (!z.string().uuid().safeParse(notificationId).success)
    return { ok: false, error: "Invalid id" };

  const [counts, rows] = await Promise.all([
    db
      .select({
        status: notificationReceipt.status,
        n: count(),
      })
      .from(notificationReceipt)
      .where(eq(notificationReceipt.notificationId, notificationId))
      .groupBy(notificationReceipt.status),
    db
      .select({
        id: notificationReceipt.id,
        name: notificationReceipt.name,
        email: notificationReceipt.email,
        churchName: church.name,
        status: notificationReceipt.status,
        error: notificationReceipt.error,
        createdAt: notificationReceipt.createdAt,
      })
      .from(notificationReceipt)
      .leftJoin(church, eq(church.id, notificationReceipt.churchId))
      /*
       * Anything that did not arrive comes first.
       *
       * The reason to open this list is almost always "did it reach them?",
       * and a bounce buried on page four of an alphabetical list is a bounce
       * nobody finds.
       */
      .orderBy(
        sql`case ${notificationReceipt.status}
              when 'undelivered' then 0
              when 'failed' then 1
              when 'sent' then 2
              else 3 end`,
        asc(notificationReceipt.email),
      )
      .where(eq(notificationReceipt.notificationId, notificationId))
      .limit(500),
  ]);

  const by = (s: string) =>
    Number(counts.find((c) => c.status === s)?.n ?? 0);

  return {
    ok: true,
    summary: {
      total: counts.reduce((n, c) => n + Number(c.n), 0),
      delivered: by("delivered"),
      sent: by("sent"),
      undelivered: by("undelivered"),
      failed: by("failed"),
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        churchName: r.churchName,
        status: r.status,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  };
}
