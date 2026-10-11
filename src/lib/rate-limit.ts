import "server-only";

import { headers } from "next/headers";

/**
 * A ceiling on how often one address may do something.
 *
 * This lived in `meeting-api.ts`, which is where it was first needed and where
 * four things outside the meetings module — the contribution proof upload, the
 * public contribution form, the welcome card and now the signup checks — were
 * importing it from. Each of those was dragging `lib/meetings` and its whole
 * dependency tree into a route that wanted a counter. Its own file, for the
 * same reason `partner-link.ts` is its own file.
 *
 * In-memory and therefore per-worker: with PM2 running two workers an attacker
 * gets twice the allowance. That is a factor of two against limits chosen with
 * orders of magnitude of headroom, and the alternative — a table write on every
 * attempt — would put a hot row in front of the path it is protecting.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) sweepBuckets(now);
    return { ok: true, retryAfterSec: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Drop expired buckets. Only ever removes entries that have already lapsed. */
function sweepBuckets(now: number): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Forget a bucket after a success, so one typo doesn't cost a whole window. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Who is asking, as well as we can tell behind Cloudflare.
 *
 * "unknown" rather than null, deliberately: everybody we cannot identify
 * shares one bucket, which is the safe way round. Falling back to no limit
 * would mean a stripped header turns the ceiling off.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
