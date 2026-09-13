/**
 * The arithmetic behind the superadmin finance page.
 *
 * Kept apart from the queries so it can be tested without a database, and kept
 * honest about one thing in particular: a church on a plan is not the same as
 * a church paying for a plan. A trial, a 100% discount and a lapsed renewal
 * all look like "plan: pro" in the row, and counting any of them as revenue is
 * how a dashboard ends up flattering.
 */

export type PlanId = "starter" | "growth" | "pro" | "enterprise";

/** Where a church sits relative to its free trial. */
export type TrialBucket = "none" | "active" | "ending_soon" | "expired";

/** A trial inside this many days is worth chasing. */
export const ENDING_SOON_DAYS = 10;

export function trialBucket(
  trialEndsAt: Date | string | null,
  now: Date,
): TrialBucket {
  if (!trialEndsAt) return "none";
  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return "none";
  if (end.getTime() <= now.getTime()) return "expired";
  const days = (end.getTime() - now.getTime()) / 86_400_000;
  return days <= ENDING_SOON_DAYS ? "ending_soon" : "active";
}

/**
 * What a church contributes to monthly recurring revenue.
 *
 * Zero while they are still on trial: the money is not ours until the trial
 * ends and they renew. Zero once the renewal date has passed, too — a plan
 * nobody has paid to extend is a lapsed plan, not income. Enterprise has no
 * list price, so its real figure has to come from what they actually paid
 * rather than from a price list.
 */
export function monthlyValue(opts: {
  plan: PlanId;
  prices: Record<PlanId, number | null>;
  discountPct?: number | null;
  trialEndsAt?: Date | string | null;
  planRenewsAt?: Date | string | null;
  now: Date;
}): number {
  const { plan, prices, now } = opts;

  // Still inside a trial: the money is not ours yet.
  const trial = trialBucket(opts.trialEndsAt ?? null, now);
  if (trial === "active" || trial === "ending_soon") return 0;

  if (opts.planRenewsAt) {
    const renews = new Date(opts.planRenewsAt);
    if (!Number.isNaN(renews.getTime()) && renews.getTime() < now.getTime()) {
      return 0;
    }
  }

  const list = prices[plan];
  if (list === null || list === undefined) return 0;

  const disc = Math.min(100, Math.max(0, Math.round(opts.discountPct ?? 0)));
  return Math.round(list * (1 - disc / 100));
}

/**
 * Why a church is worth nothing this month.
 *
 * Zero has four quite different meanings here and they call for different
 * actions: a trial is a sale in progress, a lapsed plan is a sale to rescue,
 * the free tier is working as designed, and enterprise just means the number
 * lives in a contract rather than a price list. Showing "—" for all four
 * throws that away.
 */
export type ZeroReason = "trial" | "lapsed" | "free" | "custom" | null;

export function zeroReason(opts: {
  plan: PlanId;
  prices: Record<PlanId, number | null>;
  trialEndsAt?: Date | string | null;
  planRenewsAt?: Date | string | null;
  now: Date;
}): ZeroReason {
  const trial = trialBucket(opts.trialEndsAt ?? null, opts.now);
  if (trial === "active" || trial === "ending_soon") return "trial";

  if (opts.planRenewsAt) {
    const renews = new Date(opts.planRenewsAt);
    if (!Number.isNaN(renews.getTime()) && renews.getTime() < opts.now.getTime()) {
      return "lapsed";
    }
  }

  const list = opts.prices[opts.plan];
  if (list === null || list === undefined) return "custom";
  if (list === 0) return "free";
  return null;
}

export type PaymentLike = {
  amount: number | string;
  status: "pending" | "success" | "failed";
  paidAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type PaymentTotals = {
  collected: number;
  pending: number;
  failed: number;
  count: number;
};

/** Add up a list of payments, counting only what actually landed. */
export function totalPayments(rows: PaymentLike[]): PaymentTotals {
  const out: PaymentTotals = {
    collected: 0,
    pending: 0,
    failed: 0,
    count: rows.length,
  };
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (r.status === "success") out.collected += amt;
    else if (r.status === "pending") out.pending += amt;
    else out.failed += amt;
  }
  return out;
}

/**
 * Group payments into buckets by month, oldest first.
 *
 * Uses the date the money arrived, not the date the row was written — an
 * offline transfer recorded three weeks late belongs to the month it was paid,
 * or every month-end total is wrong twice.
 */
export function revenueByMonth(
  rows: PaymentLike[],
  months: number,
  now: Date,
): { month: string; total: number }[] {
  const buckets = new Map<string, number>();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKey(d);
    keys.push(k);
    buckets.set(k, 0);
  }
  for (const r of rows) {
    if (r.status !== "success") continue;
    const when = r.paidAt ?? r.createdAt;
    if (!when) continue;
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) continue;
    const k = monthKey(d);
    if (!buckets.has(k)) continue;
    buckets.set(k, (buckets.get(k) ?? 0) + (Number(r.amount) || 0));
  }
  return keys.map((month) => ({ month, total: buckets.get(month) ?? 0 }));
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * How much of the wallet float is money we owe back in service.
 *
 * A wallet balance is not revenue. Churches top it up in advance and spend it
 * on SMS and storage; until they spend it, it is a liability sitting on our
 * side of the line. Showing it next to revenue without saying so is the
 * fastest way to believe the platform is twice as healthy as it is.
 */
export function walletLiability(balances: (number | string)[]): number {
  return balances.reduce<number>((n, b) => n + (Number(b) || 0), 0);
}
