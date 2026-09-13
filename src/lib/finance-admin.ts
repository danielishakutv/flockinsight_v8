import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, payment, walletTxn, walletTopup } from "@/db/schema";
import { getPlanPrices } from "@/lib/pricing";
import { getReferralRewards } from "@/lib/referrals";
import {
  monthlyValue,
  revenueByMonth,
  totalPayments,
  trialBucket,
  walletLiability,
  zeroReason,
  type PlanId,
  type TrialBucket,
  type ZeroReason,
} from "@/lib/finance-admin-shared";

/**
 * Everything the money page needs, in one pass.
 *
 * Deliberately one module rather than scattered queries: the numbers on this
 * page are read against each other — revenue beside float held, MRR beside
 * trials about to end — and they mislead badly if they are computed at
 * different moments or on different definitions.
 */

const MONTHS_SHOWN = 12;

export type FinanceChurchRow = {
  id: string;
  name: string;
  plan: PlanId;
  discountPct: number;
  walletBalance: number;
  trialEndsAt: Date | null;
  trialState: TrialBucket;
  planRenewsAt: Date | null;
  monthly: number;
  /** Set when monthly is 0, saying which kind of zero it is. */
  zeroReason: ZeroReason;
  referredByName: string | null;
  referralRewardedAt: Date | null;
};

export type PaymentRow = {
  id: string;
  churchId: string;
  churchName: string | null;
  plan: PlanId | null;
  amount: number;
  currency: string;
  gateway: string;
  reference: string;
  status: "pending" | "success" | "failed";
  periodMonths: number | null;
  note: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

export type FinanceOverview = {
  /** Recurring value of the churches actually paying today. */
  mrr: number;
  collectedThisMonth: number;
  collectedThisYear: number;
  pendingNow: number;
  /** Topped-up money not yet spent. Ours to hold, not ours to keep. */
  walletFloat: number;
  trials: { active: number; endingSoon: number; expired: number };
  /** Referral credit already paid out, and what is still owed. */
  referralPaid: number;
  referralPending: number;
  byMonth: { month: string; total: number }[];
  churches: FinanceChurchRow[];
  payments: PaymentRow[];
};

export async function getFinanceOverview(): Promise<FinanceOverview> {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);

  const [prices, rewards, churchRows, paymentRows] = await Promise.all([
    getPlanPrices(),
    getReferralRewards(),
    db
      .select({
        id: church.id,
        name: church.name,
        plan: church.plan,
        discountPct: church.planDiscountPct,
        walletBalance: church.walletBalance,
        trialEndsAt: church.trialEndsAt,
        planRenewsAt: church.planRenewsAt,
        referredByChurchId: church.referredByChurchId,
        referralRewardedAt: church.referralRewardedAt,
      })
      .from(church),
    db
      .select({
        id: payment.id,
        churchId: payment.churchId,
        churchName: church.name,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        reference: payment.reference,
        status: payment.status,
        periodMonths: payment.periodMonths,
        note: payment.note,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      })
      .from(payment)
      // Left-joined on purpose: a payment whose church was later deleted is
      // still money that came in, and hiding it would understate the year.
      .leftJoin(church, eq(church.id, payment.churchId))
      .orderBy(desc(payment.createdAt))
      .limit(500),
  ]);

  const nameById = new Map(churchRows.map((c) => [c.id, c.name]));

  const churches: FinanceChurchRow[] = churchRows
    .map((c) => ({
      id: c.id,
      name: c.name,
      plan: c.plan as PlanId,
      discountPct: c.discountPct ?? 0,
      walletBalance: Number(c.walletBalance) || 0,
      trialEndsAt: c.trialEndsAt ? new Date(c.trialEndsAt) : null,
      trialState: trialBucket(c.trialEndsAt, now),
      planRenewsAt: c.planRenewsAt ? new Date(c.planRenewsAt) : null,
      monthly: monthlyValue({
        plan: c.plan as PlanId,
        prices,
        discountPct: c.discountPct,
        trialEndsAt: c.trialEndsAt,
        planRenewsAt: c.planRenewsAt,
        now,
      }),
      zeroReason: zeroReason({
        plan: c.plan as PlanId,
        prices,
        trialEndsAt: c.trialEndsAt,
        planRenewsAt: c.planRenewsAt,
        now,
      }),
      referredByName: c.referredByChurchId
        ? (nameById.get(c.referredByChurchId) ?? "a deleted church")
        : null,
      referralRewardedAt: c.referralRewardedAt
        ? new Date(c.referralRewardedAt)
        : null,
    }))
    .sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));

  const payments: PaymentRow[] = paymentRows.map((p) => ({
    id: p.id,
    churchId: p.churchId,
    churchName: p.churchName,
    plan: (p.plan as PlanId) ?? null,
    amount: Number(p.amount) || 0,
    currency: p.currency,
    gateway: p.gateway,
    reference: p.reference,
    status: p.status,
    periodMonths: p.periodMonths,
    note: p.note,
    createdAt: new Date(p.createdAt),
    paidAt: p.paidAt ? new Date(p.paidAt) : null,
  }));

  const inWindow = payments.filter((p) => {
    const when = p.paidAt ?? p.createdAt;
    return when >= windowStart;
  });

  const thisMonth = totalPayments(
    payments.filter((p) => (p.paidAt ?? p.createdAt) >= monthStart),
  );
  const thisYear = totalPayments(
    payments.filter((p) => (p.paidAt ?? p.createdAt) >= yearStart),
  );
  const allPending = totalPayments(payments.filter((p) => p.status === "pending"));

  /*
   * Referral credit already handed out, and what we still owe.
   *
   * Counted from the churches themselves rather than from wallet rows: the
   * payout is claimed with a conditional update on referralRewardedAt, so that
   * column is the record of who has been paid. Pending means referred and
   * subscribed, but not yet rewarded.
   */
  const referredChurches = churches.filter((c) => c.referredByName !== null);
  const referralPaid =
    referredChurches.filter((c) => c.referralRewardedAt !== null).length *
    (rewards.referrer + rewards.referred);
  const referralPending =
    referredChurches.filter(
      (c) => c.referralRewardedAt === null && c.trialState !== "active",
    ).length * (rewards.referrer + rewards.referred);

  return {
    mrr: churches.reduce((n, c) => n + c.monthly, 0),
    collectedThisMonth: thisMonth.collected,
    collectedThisYear: thisYear.collected,
    pendingNow: allPending.pending,
    walletFloat: walletLiability(churches.map((c) => c.walletBalance)),
    trials: {
      active: churches.filter((c) => c.trialState === "active").length,
      endingSoon: churches.filter((c) => c.trialState === "ending_soon").length,
      expired: churches.filter((c) => c.trialState === "expired").length,
    },
    referralPaid,
    referralPending,
    byMonth: revenueByMonth(inWindow, MONTHS_SHOWN, now),
    churches,
    payments: payments.slice(0, 100),
  };
}

export type WalletMovement = {
  id: string;
  churchName: string | null;
  kind: string;
  category: string | null;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: Date;
};

/** The last movements across every church's wallet, newest first. */
export async function recentWalletMovements(
  limit = 50,
): Promise<WalletMovement[]> {
  const rows = await db
    .select({
      id: walletTxn.id,
      churchName: church.name,
      kind: walletTxn.kind,
      category: walletTxn.category,
      amount: walletTxn.amount,
      balanceAfter: walletTxn.balanceAfter,
      reason: walletTxn.reason,
      createdAt: walletTxn.createdAt,
    })
    .from(walletTxn)
    .leftJoin(church, eq(church.id, walletTxn.churchId))
    .orderBy(desc(walletTxn.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    churchName: r.churchName,
    kind: r.kind,
    category: r.category,
    amount: Number(r.amount) || 0,
    balanceAfter: Number(r.balanceAfter) || 0,
    reason: r.reason,
    createdAt: new Date(r.createdAt),
  }));
}

/** Top-ups still waiting on their gateway to confirm. */
export async function pendingTopups(): Promise<
  { id: string; churchName: string | null; amount: number; reference: string; createdAt: Date }[]
> {
  const rows = await db
    .select({
      id: walletTopup.id,
      churchName: church.name,
      amount: walletTopup.amount,
      reference: walletTopup.reference,
      createdAt: walletTopup.createdAt,
    })
    .from(walletTopup)
    .leftJoin(church, eq(church.id, walletTopup.churchId))
    .where(eq(walletTopup.status, "pending"))
    .orderBy(desc(walletTopup.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    churchName: r.churchName,
    amount: Number(r.amount) || 0,
    reference: r.reference,
    createdAt: new Date(r.createdAt),
  }));
}

/** Money collected per gateway over the last year — who we actually bank with. */
export async function revenueByGateway(): Promise<
  { gateway: string; total: number; count: number }[]
> {
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const rows = await db
    .select({
      gateway: payment.gateway,
      total: sql<string>`coalesce(sum(${payment.amount}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(payment)
    .where(
      and(
        eq(payment.status, "success"),
        isNotNull(payment.paidAt),
        gte(payment.paidAt, yearAgo),
      ),
    )
    .groupBy(payment.gateway);

  return rows
    .map((r) => ({
      gateway: r.gateway,
      total: Number(r.total) || 0,
      count: r.count,
    }))
    .sort((a, b) => b.total - a.total);
}
