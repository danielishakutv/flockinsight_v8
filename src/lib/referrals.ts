import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { creditWallet } from "@/lib/wallet";
import { getSetting, setSetting } from "@/lib/platform-settings";

/**
 * Church-to-church referral rewards.
 *
 * The scheme, and why it is this one:
 *
 *   - **Wallet credit, not a free month.** The wallet and its ledger already
 *     exist, so a reward is one insert and is auditable afterwards. A free
 *     month means moving a renewal date, which tangles with proration and
 *     with a church that is mid-cycle. Credit is also the thing churches
 *     actually run short of — SMS — so it gets used rather than forgotten.
 *
 *   - **Paid on the referred church's FIRST PAYMENT, never at signup.** A
 *     reward for signing someone up is a reward for creating accounts, and it
 *     would be farmed within a week. Paying when they pay means we only ever
 *     give away money we have earned.
 *
 *   - **Both sides get something.** The referrer gets the larger share for
 *     doing the recommending; the new church gets a smaller welcome credit,
 *     which is what makes the link worth clicking rather than just worth
 *     sharing.
 *
 *   - **Once per referred church, ever.** Guarded by `referralRewardedAt` on
 *     the referred church, so a second payment, a renewal or a replayed
 *     callback cannot pay it twice.
 */

export const REFERRER_REWARD_KEY = "referral_reward_referrer";
export const REFERRED_REWARD_KEY = "referral_reward_referred";

/** Naira. Roughly a third of a Growth month, which is worth telling a friend about. */
export const DEFAULT_REFERRER_REWARD = 2000;
/** Naira. Enough to send a few hundred SMS and see the value. */
export const DEFAULT_REFERRED_REWARD = 1000;

export type ReferralRewards = { referrer: number; referred: number };

export async function getReferralRewards(): Promise<ReferralRewards> {
  const [a, b] = await Promise.all([
    getSetting(REFERRER_REWARD_KEY, String(DEFAULT_REFERRER_REWARD)),
    getSetting(REFERRED_REWARD_KEY, String(DEFAULT_REFERRED_REWARD)),
  ]);
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    referrer: num(a, DEFAULT_REFERRER_REWARD),
    referred: num(b, DEFAULT_REFERRED_REWARD),
  };
}

export async function setReferralRewards(r: ReferralRewards): Promise<void> {
  await Promise.all([
    setSetting(REFERRER_REWARD_KEY, String(Math.max(0, Math.round(r.referrer)))),
    setSetting(REFERRED_REWARD_KEY, String(Math.max(0, Math.round(r.referred)))),
  ]);
}

/* ------------------------------------------------------------------ *
 * Paying the reward
 * ------------------------------------------------------------------ */

export type AwardResult =
  | {
      awarded: false;
      reason: "no-referrer" | "already-paid" | "nothing-to-pay" | "not-paid" | "failed";
    }
  | { awarded: true; referrerId: string; referrer: number; referred: number };

/**
 * Pay the referral bonus for a church that has just paid for the first time.
 *
 * Safe to call after every payment, and as often as anyone likes:
 *
 * - **Real money only.** It checks for itself that the church has a
 *   successful payment of more than ₦0, so a caller that forgets — a free
 *   activation, a 100% discount, an admin setting a plan by hand — cannot pay
 *   a reward for a payment that never happened ("not-paid").
 * - **The claim and the credits are ONE transaction.** `referralRewardedAt` is
 *   stamped by a conditional UPDATE (`where referral_rewarded_at is null`), so
 *   a replayed callback blocks on the row lock and then matches nothing — and
 *   both wallet credits run inside the same transaction. It used to stamp the
 *   church first and credit afterwards in separate transactions: a credit that
 *   failed left the church marked rewarded for ever with nobody paid, and
 *   nothing showed it. Now a failure rolls the stamp back with the credits,
 *   and the next payment, callback or reconcile sweep tries again.
 *
 * Never throws: a payment must succeed even if crediting a bonus fails. A
 * failure is logged, written to the audit trail as critical with the church,
 * and returned as "failed" rather than dressed up as "nothing to pay".
 */
export async function awardReferralIfDue(churchId: string): Promise<AwardResult> {
  try {
    const [c] = await db
      .select({
        id: church.id,
        name: church.name,
        referredByChurchId: church.referredByChurchId,
        referralRewardedAt: church.referralRewardedAt,
      })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1);

    if (!c?.referredByChurchId) return { awarded: false, reason: "no-referrer" };
    if (c.referralRewardedAt) return { awarded: false, reason: "already-paid" };

    const rewards = await getReferralRewards();
    if (rewards.referrer <= 0 && rewards.referred <= 0) {
      return { awarded: false, reason: "nothing-to-pay" };
    }

    const [paid] = await db
      .select({ id: payment.id })
      .from(payment)
      .where(
        and(
          eq(payment.churchId, churchId),
          eq(payment.status, "success"),
          gt(payment.amount, 0),
        ),
      )
      .limit(1);
    if (!paid) return { awarded: false, reason: "not-paid" };

    const referrerId = c.referredByChurchId;
    return await db.transaction(async (tx) => {
      // Looked up before anything is written: a referrer that no longer
      // exists means there is nobody to reward, not a failure to retry.
      const [referrer] = await tx
        .select({ name: church.name })
        .from(church)
        .where(eq(church.id, referrerId))
        .limit(1);
      if (!referrer) return { awarded: false as const, reason: "no-referrer" as const };

      // The claim. A concurrent caller waits on this row and then matches
      // zero rows, so exactly one of them pays.
      const claimed = await tx
        .update(church)
        .set({ referralRewardedAt: new Date() })
        .where(and(eq(church.id, churchId), isNull(church.referralRewardedAt)))
        .returning({ id: church.id });
      if (claimed.length === 0) {
        return { awarded: false as const, reason: "already-paid" as const };
      }

      // In the claim's transaction: if either credit throws, the stamp above
      // is rolled back with it.
      if (rewards.referrer > 0) {
        await creditWallet(
          {
            churchId: referrerId,
            amount: rewards.referrer,
            category: "adjustment",
            reason: `Referral reward — ${c.name} joined and subscribed`,
          },
          tx,
        );
      }
      if (rewards.referred > 0) {
        await creditWallet(
          {
            churchId: c.id,
            amount: rewards.referred,
            category: "adjustment",
            reason: `Welcome credit — referred by ${referrer.name}`,
          },
          tx,
        );
      }

      return {
        awarded: true as const,
        referrerId,
        referrer: rewards.referrer,
        referred: rewards.referred,
      };
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[referrals] awardReferralIfDue failed for church ${churchId}`, e);
    try {
      // Imported here so the reward path does not pull the audit module (and
      // its request context) into everything that awards a referral.
      const { auditSystem } = await import("@/lib/audit");
      await auditSystem({
        action: "platform.referral.award_failed",
        summary: `Referral reward for church ${churchId} could not be paid: ${error}. Nothing was credited and the church is not marked rewarded; it will be retried on the next payment or reconcile run.`,
        targetType: "church",
        targetId: churchId,
        severity: "critical",
        meta: { churchId, error },
      });
    } catch (auditErr) {
      console.error(
        `[referrals] and the audit entry for that failure could not be written either (church ${churchId})`,
        auditErr,
      );
    }
    return { awarded: false, reason: "failed" };
  }
}

/* ------------------------------------------------------------------ *
 * Reading a church's own referrals
 * ------------------------------------------------------------------ */

export type ReferredChurch = {
  id: string;
  name: string;
  joinedAt: Date | null;
  /** Have they paid for anything yet? This is what turns the reward on. */
  subscribed: boolean;
  rewardedAt: Date | null;
};

export type ReferralSummary = {
  total: number;
  subscribed: number;
  pending: number;
  earned: number;
  rewards: ReferralRewards;
  churches: ReferredChurch[];
};

/**
 * Who this church has referred, and what it has earned.
 *
 * "Subscribed" is a successful payment OF MONEY rather than a paid plan flag,
 * because a superadmin can set a church's plan by hand and that should not pay
 * anybody a referral bonus. That hand-set plan still records a "successful"
 * payment — of ₦0 — and counting it showed a church as Subscribed for a reward
 * that, rightly, never came.
 */
export async function referralSummary(churchId: string): Promise<ReferralSummary> {
  const rewards = await getReferralRewards();

  // Two queries and a join in JS, NOT a correlated subquery. Inside a raw
  // `sql` template drizzle only qualifies ${table.column} when the outer query
  // has a join; this one does not, so `where ${payment.churchId} = ${church.id}`
  // would render as `where "church_id" = "id"` with both names binding to
  // `payment` — never true, and every church would look like it had never
  // paid. See lib/sql-safety.test.ts, which fails the build on that shape.
  const rows = await db
    .select({
      id: church.id,
      name: church.name,
      joinedAt: church.referredAt,
      rewardedAt: church.referralRewardedAt,
    })
    .from(church)
    .where(eq(church.referredByChurchId, churchId))
    .orderBy(desc(church.referredAt));

  const ids = rows.map((r) => r.id);
  const paid = new Set<string>();
  if (ids.length > 0) {
    const paidRows = await db
      .select({ churchId: payment.churchId })
      .from(payment)
      .where(
        and(
          inArray(payment.churchId, ids),
          eq(payment.status, "success"),
          gt(payment.amount, 0),
        ),
      )
      .groupBy(payment.churchId);
    for (const p of paidRows) if (p.churchId) paid.add(p.churchId);
  }

  const churches: ReferredChurch[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    joinedAt: r.joinedAt,
    subscribed: paid.has(r.id),
    rewardedAt: r.rewardedAt,
  }));

  const subscribed = churches.filter((c) => c.subscribed).length;
  return {
    total: churches.length,
    subscribed,
    pending: churches.length - subscribed,
    earned: churches.filter((c) => c.rewardedAt).length * rewards.referrer,
    rewards,
    churches,
  };
}

/** Platform-wide referral numbers, for the admin overview. */
export async function platformReferralStats() {
  const [row] = await db
    .select({
      referred: sql<number>`count(*)::int`,
      rewarded: sql<number>`count(*) filter (where ${church.referralRewardedAt} is not null)::int`,
    })
    .from(church)
    .where(isNotNull(church.referredByChurchId));
  return { referred: row?.referred ?? 0, rewarded: row?.rewarded ?? 0 };
}
