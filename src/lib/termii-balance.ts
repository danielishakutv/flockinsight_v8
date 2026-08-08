import "server-only";
import { desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { termiiSnapshot } from "@/db/schema";
import { termiiBase } from "@/lib/sms";

/**
 * Reads the Termii master account balance — the float every church's SMS is
 * actually sent from. Churches pay us into their own wallet, but delivery is
 * drawn from this one account, so it is the number that decides whether SMS
 * keeps working platform-wide.
 */

export type TermiiBalanceResult =
  | { ok: true; balance: number; currency: string }
  | { ok: false; error: string };

type TermiiBalanceResponse = {
  user?: string;
  balance?: number | string;
  currency?: string;
};

export function isTermiiConfigured(): boolean {
  return !!process.env.TERMII_API_KEY;
}

/**
 * Fetch the live balance. Never throws — a monitoring tool that crashes when
 * the thing it monitors is down is worse than useless.
 */
export async function fetchTermiiBalance(): Promise<TermiiBalanceResult> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "Termii is not configured." };

  try {
    const res = await fetch(
      `${termiiBase()}/api/get-balance?api_key=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    const data = (await res
      .json()
      .catch(() => null)) as TermiiBalanceResponse | null;

    if (!res.ok || !data || data.balance === undefined) {
      return {
        ok: false,
        error: `Termii balance unavailable (HTTP ${res.status}).`,
      };
    }

    const balance = Number(data.balance);
    if (!Number.isFinite(balance)) {
      return { ok: false, error: "Termii returned a balance we could not read." };
    }

    return { ok: true, balance, currency: data.currency || "NGN" };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? "Termii did not respond within 5 seconds."
        : "Could not reach Termii.",
    };
  }
}

/**
 * Fetch and persist. Records the failures too: three failed readings in a row
 * is itself the signal that SMS is quietly dying, and the successful ones are
 * the history that runway is computed from.
 */
export async function snapshotTermiiBalance(): Promise<TermiiBalanceResult> {
  const result = await fetchTermiiBalance();
  try {
    await db.insert(termiiSnapshot).values(
      result.ok
        ? { balance: result.balance, currency: result.currency, ok: true }
        : { balance: null, currency: null, ok: false, error: result.error },
    );
  } catch (e) {
    console.error("[termii] snapshot write failed", e);
  }
  return result;
}

export type SnapshotRow = {
  balance: number | null;
  currency: string | null;
  ok: boolean;
  error: string | null;
  fetchedAt: Date;
};

/** Most recent successful reading, for display when the API is unreachable. */
export async function latestSuccessfulSnapshot(): Promise<SnapshotRow | null> {
  const [row] = await db
    .select()
    .from(termiiSnapshot)
    .where(eq(termiiSnapshot.ok, true))
    .orderBy(desc(termiiSnapshot.fetchedAt))
    .limit(1);
  if (!row || row.balance === null) return null;

  return {
    balance: Number(row.balance),
    currency: row.currency,
    ok: true,
    error: null,
    fetchedAt: row.fetchedAt,
  };
}

/** Snapshots from the last `days` days, oldest first. */
export async function recentSnapshots(days = 30): Promise<SnapshotRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select()
    .from(termiiSnapshot)
    .where(gte(termiiSnapshot.fetchedAt, since))
    .orderBy(termiiSnapshot.fetchedAt);
  return rows.map((r) => ({
    balance: r.balance === null ? null : Number(r.balance),
    currency: r.currency,
    ok: r.ok,
    error: r.error,
    fetchedAt: r.fetchedAt,
  }));
}

/**
 * How many consecutive readings have failed, newest first. Three or more means
 * the gateway is unreachable rather than merely flaky.
 */
export async function consecutiveFailures(): Promise<number> {
  const rows = await db
    .select({ ok: termiiSnapshot.ok })
    .from(termiiSnapshot)
    .orderBy(desc(termiiSnapshot.fetchedAt))
    .limit(10);
  let n = 0;
  for (const r of rows) {
    if (r.ok) break;
    n++;
  }
  return n;
}
