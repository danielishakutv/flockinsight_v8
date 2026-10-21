/**
 * The budget arithmetic, without the database. Pure, so the boundary cases
 * are unit-tested; lib/ai/budget.ts repeats the same predicate in SQL.
 */

/** Would reserving `amount` keep spent + reserved within the ceiling? */
export function canReserve(
  row: { spent: number; reserved: number },
  ceiling: number,
  amount: number,
): boolean {
  return row.spent + row.reserved + amount <= ceiling;
}

/** 'YYYY-MM' in UTC: budgets reset on the 1st, UTC, for everyone. */
export function monthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * A reservation older than this never settled: the process died mid-call.
 * Well past the longest per-feature timeout (180 s for blog).
 */
export const STALE_AFTER_MS = 15 * 60_000;

export function isStale(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > STALE_AFTER_MS;
}

/** USD to nano-dollars, as an integer. */
export function usdToNano(usd: number): number {
  return Math.round(usd * 1e9);
}
