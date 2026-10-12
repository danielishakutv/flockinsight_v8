import "server-only";
import { and, eq, gt, gte, inArray, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  partnerEarning,
  partnerReferral,
  payment,
  smsTopup,
  walletTopup,
} from "@/db/schema";
import { payAwardsFor, settlePaystackReference } from "@/lib/billing";
import type { SettleResult } from "@/lib/paystack-outcome";
import {
  createBudget,
  DEFAULT_RECONCILE_BUDGET,
  type ReconcileBudget,
  type StopReason,
} from "@/lib/reconcile-budget";

/**
 * The safety net under the webhook.
 *
 * Asks Paystack about every platform checkout still pending after ten minutes
 * and less than a week old, through the same idempotent settle the callback
 * and the webhook use. A webhook can be missed — the dashboard URL unset, our
 * server down for the minute Paystack tried, a deploy mid-request — and a
 * missed webhook used to mean a church that had paid and stayed locked out.
 *
 * Ten minutes, so it does not race the person still on the Paystack page.
 * A week, because Paystack stops being able to tell us anything useful about
 * an abandoned checkout long before that, and verifying old junk forever is
 * a cost with no return.
 *
 * Bounded (lib/reconcile-budget.ts): a run stops at its deadline, or once
 * Paystack has failed to answer several times running, and says which in
 * `stoppedEarly`. Whatever it did not reach is still pending for the next.
 *
 * Then it sweeps recent successes for awards still owed (sweepUnpaidAwards).
 */
export async function reconcilePendingPayments(
  now: Date = new Date(),
  budget: ReconcileBudget = DEFAULT_RECONCILE_BUDGET,
): Promise<
  Record<SettleResult, number> & {
    checked: number;
    stoppedEarly: StopReason | null;
    awardsRetried: number;
  }
> {
  const newest = new Date(now.getTime() - 10 * 60_000);
  const oldest = new Date(now.getTime() - 7 * 86_400_000);

  const [subs, wallets, sms] = await Promise.all([
    db
      .select({ reference: payment.reference })
      .from(payment)
      .where(
        and(
          eq(payment.status, "pending"),
          like(payment.reference, "FI-%"),
          gte(payment.createdAt, oldest),
          lte(payment.createdAt, newest),
        ),
      )
      .limit(200),
    db
      .select({ reference: walletTopup.reference })
      .from(walletTopup)
      .where(
        and(
          eq(walletTopup.status, "pending"),
          gte(walletTopup.createdAt, oldest),
          lte(walletTopup.createdAt, newest),
        ),
      )
      .limit(200),
    db
      .select({ reference: smsTopup.reference })
      .from(smsTopup)
      .where(
        and(
          eq(smsTopup.status, "pending"),
          gte(smsTopup.createdAt, oldest),
          lte(smsTopup.createdAt, newest),
        ),
      )
      .limit(200),
  ]);

  const tally = {
    checked: 0,
    success: 0,
    already: 0,
    pending: 0,
    failed: 0,
    mismatch: 0,
    unknown: 0,
    "not-found": 0,
  };
  const clock = createBudget(Date.now(), budget);
  let stoppedEarly: StopReason | null = null;
  // One at a time: Paystack rate-limits, and nothing here is urgent enough to
  // be worth a 429.
  for (const { reference } of [...subs, ...wallets, ...sms]) {
    stoppedEarly = clock.stopReason(Date.now());
    if (stoppedEarly) {
      console.warn(
        `[payment-reconcile] stopped early (${stoppedEarly}) after ${tally.checked} reference(s); the rest wait for the next run`,
      );
      break;
    }
    tally.checked++;
    let result: SettleResult;
    try {
      result = await settlePaystackReference(reference, "Payment reconcile");
    } catch (e) {
      // Recorded and counted, so one bad row cannot stop the rest — and a run
      // that settled nothing because everything threw says so in its totals.
      console.error(`[payment-reconcile] ${reference} threw`, e);
      result = "unknown";
    }
    tally[result]++;
    clock.record(result);
  }

  const awardsRetried = await sweepUnpaidAwards(now);
  return { ...tally, stoppedEarly, awardsRetried };
}

/**
 * Pay what recent successful payments still owe to other people.
 *
 * The referral reward and the Partner commission are paid after a payment's
 * claim commits, by whichever caller won the claim (billing.ts payAwardsFor).
 * If that caller's award failed — a database blip, a deploy mid-request —
 * nothing used to come back to it: the payment was no longer pending, so this
 * cron never looked at it again, and Paystack does not resend a webhook it
 * got a 200 for. This is the coming back.
 *
 * Candidates: payments of real money that landed between ten minutes and a
 * week ago (ten minutes, so it does not race the winner's own award), on a
 * church that is either referred by another church and not yet rewarded, or
 * referred by a Partner with no earning recorded against this payment. Both
 * awards are idempotent, so a payment that legitimately earns nothing (a
 * Partner past the trail window, a suspended Partner) is only asked again,
 * never paid twice — a few cheap queries every fifteen minutes for a week.
 *
 * Two plain queries joined in JS, not a correlated subquery — the raw-SQL
 * qualifier trap in AGENTS.md.
 */
export async function sweepUnpaidAwards(now: Date = new Date()): Promise<number> {
  const newest = new Date(now.getTime() - 10 * 60_000);
  const oldest = new Date(now.getTime() - 7 * 86_400_000);
  const landed = sql`coalesce(${payment.paidAt}, ${payment.createdAt})`;

  const rows = await db
    .select({
      id: payment.id,
      referredBy: church.referredByChurchId,
      rewardedAt: church.referralRewardedAt,
      partnerId: partnerReferral.partnerId,
    })
    .from(payment)
    .innerJoin(church, eq(church.id, payment.churchId))
    .leftJoin(partnerReferral, eq(partnerReferral.churchId, payment.churchId))
    .where(
      and(
        eq(payment.status, "success"),
        gt(payment.amount, 0),
        gte(landed, oldest),
        lte(landed, newest),
      ),
    )
    .limit(500);

  const partnered = rows.filter((r) => r.partnerId).map((r) => r.id);
  const earned = new Set<string>();
  if (partnered.length) {
    const got = await db
      .select({ paymentId: partnerEarning.paymentId })
      .from(partnerEarning)
      .where(inArray(partnerEarning.paymentId, partnered));
    for (const g of got) if (g.paymentId) earned.add(g.paymentId);
  }

  const owed = rows.filter(
    (r) => (r.referredBy && !r.rewardedAt) || (r.partnerId && !earned.has(r.id)),
  );
  for (const r of owed) {
    try {
      await payAwardsFor(r.id);
    } catch (e) {
      // Both awards log their own failures; this is anything else, counted
      // in the log so one row cannot stop the sweep.
      console.error(`[payment-reconcile] award retry for payment ${r.id} threw`, e);
    }
  }
  return owed.length;
}
