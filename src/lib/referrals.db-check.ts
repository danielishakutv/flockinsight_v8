/**
 * Database-backed checks for referral rewards. Run with `pnpm test:db`.
 *
 * These exist because the things most likely to go wrong here involve money
 * and cannot be seen by reading: paying a bonus twice when Paystack replays a
 * callback, paying one for a church nobody referred, or reporting a church as
 * subscribed when it has never paid.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, payment, walletTxn } from "@/db/schema";
import {
  awardReferralIfDue,
  getReferralRewards,
  referralSummary,
  setReferralRewards,
} from "@/lib/referrals";

/*
 * The real wallet, with one switch: `failCreditFor` makes the credit to that
 * church throw, the way a lock timeout or a dropped connection would. That is
 * the only way to show what happens when the SECOND credit of a referral
 * fails after the first has already been written.
 */
const failCreditFor = vi.hoisted(() => ({ churchId: null as string | null }));
vi.mock("@/lib/wallet", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/wallet")>();
  return {
    ...real,
    creditWallet: async (...args: Parameters<typeof real.creditWallet>) => {
      if (failCreditFor.churchId && args[0].churchId === failCreditFor.churchId) {
        throw new Error("zzcheck: simulated credit failure");
      }
      return real.creditWallet(...args);
    },
  };
});

const stamp = Date.now();
const REFERRER = `zzref-referrer-${stamp}`;
const PAID = `zzref-paid-${stamp}`;
const UNPAID = `zzref-unpaid-${stamp}`;
const ORPHAN = `zzref-orphan-${stamp}`;
/** Activated for ₦0 — a plan set by hand. Has "paid" nothing. */
const COMPED = `zzref-comped-${stamp}`;
/** Paid, but the credit to it fails half-way through the reward. */
const FLAKY = `zzref-flaky-${stamp}`;
const ALL = [REFERRER, PAID, UNPAID, ORPHAN, COMPED, FLAKY];

let original: { referrer: number; referred: number };

const balance = async (id: string) => {
  const [c] = await db
    .select({ b: church.walletBalance })
    .from(church)
    .where(eq(church.id, id))
    .limit(1);
  return Number(c?.b ?? 0);
};

beforeAll(async () => {
  original = await getReferralRewards();
  await setReferralRewards({ referrer: 2000, referred: 1000 });

  const base = (id: string, name: string) => ({
    id,
    name,
    slug: id,
    handle: id,
    currency: "NGN",
    country: "Nigeria",
  });

  await db.insert(church).values([
    base(REFERRER, "ZZ Referrer"),
    { ...base(PAID, "ZZ Paid"), referredByChurchId: REFERRER, referredAt: new Date() },
    { ...base(UNPAID, "ZZ Unpaid"), referredByChurchId: REFERRER, referredAt: new Date() },
    // Nobody referred this one.
    base(ORPHAN, "ZZ Orphan"),
    { ...base(COMPED, "ZZ Comped"), referredByChurchId: REFERRER, referredAt: new Date() },
    { ...base(FLAKY, "ZZ Flaky"), referredByChurchId: REFERRER, referredAt: new Date() },
  ]);

  // An admin setting COMPED's plan by hand: a "successful" payment of nothing.
  await db.insert(payment).values({
    churchId: COMPED,
    reference: `zzref-comped-${stamp}`,
    amount: 0,
    plan: "growth",
    gateway: "admin",
    periodMonths: 12,
    status: "success",
    paidAt: new Date(),
  });
  await db.insert(payment).values({
    churchId: FLAKY,
    reference: `zzref-flaky-${stamp}`,
    amount: 5000,
    plan: "growth",
    periodMonths: 1,
    status: "success",
    paidAt: new Date(),
  });

  await db.insert(payment).values({
    churchId: PAID,
    reference: `zzref-${stamp}`,
    amount: 5000,
    plan: "growth",
    periodMonths: 1,
    status: "success",
    paidAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(walletTxn).where(inArray(walletTxn.churchId, ALL));
  await db.delete(payment).where(inArray(payment.churchId, ALL));
  // The referred rows point at the referrer, so clear them first.
  await db.delete(church).where(inArray(church.id, [PAID, UNPAID, ORPHAN, COMPED, FLAKY]));
  await db.delete(church).where(eq(church.id, REFERRER));
  await setReferralRewards(original);
});

describe("awardReferralIfDue", () => {
  it("credits both sides on the first payment", async () => {
    const before = { ref: await balance(REFERRER), paid: await balance(PAID) };

    const res = await awardReferralIfDue(PAID);
    expect(res.awarded).toBe(true);

    expect(await balance(REFERRER)).toBe(before.ref + 2000);
    expect(await balance(PAID)).toBe(before.paid + 1000);
  });

  it("does not pay again when the callback is replayed", async () => {
    // Paystack does re-send these, and a double payout is real money.
    const before = { ref: await balance(REFERRER), paid: await balance(PAID) };

    const again = await awardReferralIfDue(PAID);
    expect(again).toEqual({ awarded: false, reason: "already-paid" });

    expect(await balance(REFERRER)).toBe(before.ref);
    expect(await balance(PAID)).toBe(before.paid);
  });

  it("survives being called many times at once without overpaying", async () => {
    const before = await balance(REFERRER);
    await Promise.all(Array.from({ length: 8 }, () => awardReferralIfDue(PAID)));
    expect(await balance(REFERRER)).toBe(before);
  });

  it("pays nothing for a church nobody referred", async () => {
    const res = await awardReferralIfDue(ORPHAN);
    expect(res).toEqual({ awarded: false, reason: "no-referrer" });
  });

  it("writes a ledger entry explaining the credit", async () => {
    const rows = await db
      .select({ reason: walletTxn.reason, amount: walletTxn.amount })
      .from(walletTxn)
      .where(eq(walletTxn.churchId, REFERRER));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => (r.reason ?? "").includes("Referral reward"))).toBe(
      true,
    );
  });

  it("pays nothing for a ₦0 activation, and does not mark it rewarded", async () => {
    const before = await balance(REFERRER);
    const res = await awardReferralIfDue(COMPED);
    expect(res).toEqual({ awarded: false, reason: "not-paid" });
    expect(await balance(REFERRER)).toBe(before);
    const [c] = await db
      .select({ at: church.referralRewardedAt })
      .from(church)
      .where(eq(church.id, COMPED));
    expect(c.at).toBeNull();
  });

  it("rolls the whole reward back when the second credit fails", async () => {
    /*
     * The referrer is credited first, then the new church. Making the second
     * one throw is the case that used to strand the reward: the church was
     * already stamped "rewarded" in its own transaction, so neither church
     * was ever paid and nothing would try again.
     */
    const before = { ref: await balance(REFERRER), flaky: await balance(FLAKY) };
    failCreditFor.churchId = FLAKY;
    let res;
    try {
      res = await awardReferralIfDue(FLAKY);
    } finally {
      failCreditFor.churchId = null;
    }
    expect(res).toEqual({ awarded: false, reason: "failed" });

    // Nothing moved, and the church is still owed its reward…
    expect(await balance(REFERRER)).toBe(before.ref);
    expect(await balance(FLAKY)).toBe(before.flaky);
    const [c] = await db
      .select({ at: church.referralRewardedAt })
      .from(church)
      .where(eq(church.id, FLAKY));
    expect(c.at).toBeNull();

    // …so the next call — the reconcile sweep, the next payment — pays it.
    const retry = await awardReferralIfDue(FLAKY);
    expect(retry.awarded).toBe(true);
    expect(await balance(REFERRER)).toBe(before.ref + 2000);
    expect(await balance(FLAKY)).toBe(before.flaky + 1000);
  });

  it("pays nothing when both amounts are set to zero", async () => {
    await setReferralRewards({ referrer: 0, referred: 0 });
    const res = await awardReferralIfDue(UNPAID);
    expect(res).toEqual({ awarded: false, reason: "nothing-to-pay" });
    await setReferralRewards({ referrer: 2000, referred: 1000 });
  });
});

describe("referralSummary", () => {
  it("counts a referred church as subscribed only once it has paid", async () => {
    const s = await referralSummary(REFERRER);
    const paid = s.churches.find((c) => c.id === PAID);
    const unpaid = s.churches.find((c) => c.id === UNPAID);

    const comped = s.churches.find((c) => c.id === COMPED);

    expect(s.total).toBe(4);
    // The regression this guards: written as a correlated subquery, `subscribed`
    // came back false for everyone.
    expect(paid?.subscribed).toBe(true);
    expect(unpaid?.subscribed).toBe(false);
    // A plan set by hand for ₦0 is not a subscription, and must not look like
    // one while its reward (rightly) never comes.
    expect(comped?.subscribed).toBe(false);
    expect(s.subscribed).toBe(2);
    expect(s.pending).toBe(2);
  });

  it("counts earnings from rewards actually paid, not from signups", async () => {
    // PAID and, after its retry, FLAKY.
    const s = await referralSummary(REFERRER);
    expect(s.earned).toBe(4000);
  });

  it("returns an empty summary for a church that has referred nobody", async () => {
    const s = await referralSummary(ORPHAN);
    expect(s.total).toBe(0);
    expect(s.churches).toEqual([]);
    expect(s.earned).toBe(0);
  });
});
