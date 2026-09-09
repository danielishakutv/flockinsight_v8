/**
 * Database-backed checks for referral rewards. Run with `pnpm test:db`.
 *
 * These exist because the things most likely to go wrong here involve money
 * and cannot be seen by reading: paying a bonus twice when Paystack replays a
 * callback, paying one for a church nobody referred, or reporting a church as
 * subscribed when it has never paid.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, payment, walletTxn } from "@/db/schema";
import {
  awardReferralIfDue,
  getReferralRewards,
  referralSummary,
  setReferralRewards,
} from "@/lib/referrals";

const stamp = Date.now();
const REFERRER = `zzref-referrer-${stamp}`;
const PAID = `zzref-paid-${stamp}`;
const UNPAID = `zzref-unpaid-${stamp}`;
const ORPHAN = `zzref-orphan-${stamp}`;
const ALL = [REFERRER, PAID, UNPAID, ORPHAN];

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
  ]);

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
  await db.delete(church).where(inArray(church.id, [PAID, UNPAID, ORPHAN]));
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

    expect(s.total).toBe(2);
    // The regression this guards: written as a correlated subquery, `subscribed`
    // came back false for everyone.
    expect(paid?.subscribed).toBe(true);
    expect(unpaid?.subscribed).toBe(false);
    expect(s.subscribed).toBe(1);
    expect(s.pending).toBe(1);
  });

  it("counts earnings from rewards actually paid, not from signups", async () => {
    const s = await referralSummary(REFERRER);
    expect(s.earned).toBe(2000);
  });

  it("returns an empty summary for a church that has referred nobody", async () => {
    const s = await referralSummary(ORPHAN);
    expect(s.total).toBe(0);
    expect(s.churches).toEqual([]);
    expect(s.earned).toBe(0);
  });
});
