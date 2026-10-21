import "server-only";
import { max } from "drizzle-orm";
import { db } from "@/db";
import { userActiveDay } from "@/db/schema";
import { rollupSql } from "@/lib/active-days-sql";

const DAY_MS = 86_400_000;

/**
 * Roll real use into user_active_day, for good. Run nightly by the usage-days
 * cron; see lib/active-days-sql.ts for exactly what counts.
 *
 * The window starts two whole days before the newest stored day, so:
 *  - the counts it replaces are for complete days, which makes a re-run exact;
 *  - a missed night is caught up by the next run;
 *  - it never reaches back far enough for the 180-day analytics prune to have
 *    shrunk a day it is about to overwrite.
 *
 * An empty table is the first-run backfill: all of audit history, plus the
 * 180 days of analytics still kept. That can only UNDER-count a veteran, whose
 * older pageviews are already gone, which delays a rank and never grants a
 * false one.
 */
export async function rollupActiveDays(): Promise<{
  from: Date;
  rows: number;
  userIds: string[];
}> {
  const [latest] = await db.select({ day: max(userActiveDay.day) }).from(userActiveDay);
  const from = latest?.day
    ? new Date(Date.parse(`${latest.day}T00:00:00Z`) - 2 * DAY_MS)
    : new Date(Date.UTC(1970, 0, 1));

  const result = await db.execute<{ user_id: string }>(rollupSql(from));
  const userIds = [...new Set(result.rows.map((r) => r.user_id))];
  return { from, rows: result.rows.length, userIds };
}
