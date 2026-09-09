import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
  | { awarded: false; reason: "no-referrer" | "already-paid" | "nothing-to-pay" }
  | { awarded: true; referrerId: string; referrer: number; referred: number };

/**
 * Pay the referral bonus for a church that has just paid for the first time.
 *
 * Safe to call after every payment: it stamps `referralRewardedAt` inside the
 * same check that reads it, so a replayed Paystack callback — which does
 * happen — cannot pay twice. Never throws: a payment must succeed even if
 * crediting a bonus somehow fails.
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

    // Claim the payout first, conditionally. If another request got here at
    // the same time its update matches zero rows and it stops — so exactly one
    // of them pays out.
    const claimed = await db
      .update(church)
      .set({ referralRewardedAt: new Date() })
      .where(
        and(eq(church.id, churchId), sql`${church.referralRewardedAt} is null`),
      )
      .returning({ id: church.id });
    if (claimed.length === 0) return { awarded: false, reason: "already-paid" };

    const [referrer] = await db
      .select({ name: church.name })
      .from(church)
      .where(eq(church.id, c.referredByChurchId))
      .limit(1);

    if (rewards.referrer > 0) {
      await creditWallet({
        churchId: c.referredByChurchId,
        amount: rewards.referrer,
        category: "adjustment",
        reason: `Referral reward — ${c.name} joined and subscribed`,
      });
    }
    if (rewards.referred > 0) {
      await creditWallet({
        churchId: c.id,
        amount: rewards.referred,
        category: "adjustment",
        reason: referrer?.name
          ? `Welcome credit — referred by ${referrer.name}`
          : "Welcome credit — referral",
      });
    }

    return {
      awarded: true,
      referrerId: c.referredByChurchId,
      referrer: rewards.referrer,
      referred: rewards.referred,
    };
  } catch (e) {
    console.error("[referrals] awardReferralIfDue failed", e);
    return { awarded: false, reason: "nothing-to-pay" };
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
 * "Subscribed" is a successful payment rather than a paid plan flag, because a
 * superadmin can set a church's plan by hand and that should not pay anybody a
 * referral bonus.
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
        and(inArray(payment.churchId, ids), eq(payment.status, "success")),
      )
      .groupBy(payment.churchId);
    for (const p of paidRows) paid.add(p.churchId);
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
