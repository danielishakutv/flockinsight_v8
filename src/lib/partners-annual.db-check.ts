/**
 * What a Partner is paid when a church pays for a whole year. Run with
 * `pnpm test:db`.
 *
 * `partners-shared.test.ts` proves the ARITHMETIC with no database: given the
 * months a payment covers, what each one earns. This file exists for the half
 * of the answer only Postgres can give — **which months a payment covers**,
 * which is a `sum(period_months)` over the church's earlier payments with a
 * deterministic order and a filter that excludes payments of zero. None of
 * that can be unit-tested, and all of it decides money:
 *
 * - counting PAYMENTS instead of months paid the Partner one commission for a
 *   year and let the trail window expire unused;
 * - counting a ₦0 admin activation as a month moved the church's first real
 *   payment to month two, so the first commission was paid to nobody;
 * - ordering with `<=` instead of `(paid_at, id) <` made two payments sharing
 *   a timestamp each count the other, and both lost the first commission;
 * - ordering by the date paid ALONE let a transfer recorded late, with its
 *   real (earlier) date, be priced as month one and earn the first again.
 *
 * And the rest of the October audit: commission on the plan price rather than
 * the international surcharge, the tier counting a year paid months ago but
 * never a ₦0 activation, and a voided payment's commission being reversed.
 *
 * Every row this file writes is a fixture it created, named with a `zzcheck-`
 * prefix, and it removes only those at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  partner,
  partnerEarning,
  partnerPayout,
  partnerReferral,
  payment,
  user,
} from "@/db/schema";
import {
  awardPartnerCommission,
  livePayingChurches,
  reversePartnerCommission,
} from "@/lib/partners";
import { DEFAULT_PARTNER_RATES } from "@/lib/partners-shared";

const STAMP = Date.now().toString(36);
const USER_ID = `zzcheck-annual-${STAMP}`;
const CHURCH_ID = `zzcheck-church-${STAMP}`;
/** A second church, to prove the month count is scoped to one of them. */
const OTHER_CHURCH_ID = `zzcheck-other-${STAMP}`;

let partnerId = "";

const rates = DEFAULT_PARTNER_RATES;
const base = rates.tiers[0];

/** ₦10,000 a month, so a year at two months free is ₦100,000. */
const MONTHLY = 10_000;
const ANNUAL = MONTHLY * 10;

/**
 * Record a successful payment and award whatever it earns.
 *
 * `paidAt` is passed in rather than defaulted, because the ORDER of a church's
 * payments is the thing under test here and "now" for two rows written in the
 * same millisecond is not an order.
 */
async function pay(opts: {
  amount: number;
  months: number;
  paidAt: Date;
  gateway?: string;
  surchargeAmount?: number;
  churchId?: string;
  /** Write the row without awarding, for the cases that award by hand. */
  award?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(payment)
    .values({
      churchId: opts.churchId ?? CHURCH_ID,
      plan: "growth",
      amount: opts.amount,
      surchargeAmount: opts.surchargeAmount ?? 0,
      currency: "NGN",
      gateway: opts.gateway ?? "paystack",
      reference: `zzcheck-${STAMP}-${Math.random().toString(36).slice(2, 10)}`,
      status: "success",
      periodMonths: opts.months,
      paidAt: opts.paidAt,
    })
    .returning({ id: payment.id });
  if (opts.award !== false) await awardPartnerCommission(row.id);
  return row.id;
}

/** Every earning row this church has, kinds sorted, for whole-ledger checks. */
async function churchKinds(churchId = CHURCH_ID) {
  const rows = await db
    .select({ kind: partnerEarning.kind, status: partnerEarning.status })
    .from(partnerEarning)
    .where(eq(partnerEarning.churchId, churchId));
  return rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => r.kind)
    .sort();
}

/** Churches that exist only for the tier check, cleaned up by id. */
const TIER_CHURCHES = [0, 1, 2, 3].map((i) => `zzcheck-tier-${i}-${STAMP}`);

async function earningsFor(paymentId: string) {
  return db
    .select({
      kind: partnerEarning.kind,
      amount: partnerEarning.amount,
      rateBps: partnerEarning.rateBps,
      note: partnerEarning.note,
    })
    .from(partnerEarning)
    .where(eq(partnerEarning.paymentId, paymentId))
    .orderBy(asc(partnerEarning.rateBps));
}

async function clearLedger() {
  await db.delete(partnerEarning).where(eq(partnerEarning.partnerId, partnerId));
  await db.delete(payment).where(eq(payment.churchId, CHURCH_ID));
}

beforeAll(async () => {
  await db.insert(user).values({
    id: USER_ID,
    name: "Annual Check",
    email: `${USER_ID}@example.invalid`,
  });
  const [p] = await db
    .insert(partner)
    .values({
      userId: USER_ID,
      code: `ZY${STAMP.toUpperCase().slice(-6)}`,
      displayName: "Annual Check",
      status: "active",
      phone: "08000000001",
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
    })
    .returning({ id: partner.id });
  partnerId = p.id;

  await db.insert(church).values({
    id: CHURCH_ID,
    name: "Annual Check Church",
    slug: `zzcheck-annual-${STAMP}`,
    plan: "growth",
    status: "active",
  });
  await db
    .insert(partnerReferral)
    .values({ partnerId, churchId: CHURCH_ID, source: "link" });
});

afterAll(async () => {
  // Only the fixtures created above. The ledger is RESTRICT on the partner
  // (money outlives a login), so it goes first; the partner then cascades from
  // the user, and the referral from the church.
  if (partnerId) {
    await db.delete(partnerEarning).where(eq(partnerEarning.partnerId, partnerId));
    await db.delete(partnerPayout).where(eq(partnerPayout.partnerId, partnerId));
  }
  await db.delete(payment).where(eq(payment.churchId, CHURCH_ID));
  await db.delete(payment).where(eq(payment.churchId, OTHER_CHURCH_ID));
  await db.delete(payment).where(inArray(payment.churchId, TIER_CHURCHES));
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.delete(church).where(eq(church.id, CHURCH_ID));
  await db.delete(church).where(eq(church.id, OTHER_CHURCH_ID));
  await db.delete(church).where(inArray(church.id, TIER_CHURCHES));
});

describe("a church that pays for a whole year", () => {
  it("earns the first, the second and the trail in one credit", async () => {
    await clearLedger();
    const id = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-01-05T10:00:00Z"),
    });

    const rows = await earningsFor(id);
    // Three rows, one per kind — never ten identical trail rows, because the
    // unique index is on (payment, kind) and that is what carries idempotence.
    expect(rows.map((r) => r.kind).sort()).toEqual(["first", "second", "trail"]);

    const perMonth = ANNUAL / 12;
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(Number(byKind.first.amount)).toBeCloseTo(
      Math.round(perMonth * base.firstBps) / 10_000,
      2,
    );
    expect(Number(byKind.trail.amount)).toBeCloseTo(
      Math.round(perMonth * 10 * rates.trailBps) / 10_000,
      2,
    );
    // And it says what it is for, so three rows on one day is not a mystery.
    expect(byKind.trail.note).toMatch(/months 3–12 of a 12-month payment/);
  });

  it("awards nothing on a replay", async () => {
    await clearLedger();
    const id = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-01-05T10:00:00Z"),
    });
    const before = await earningsFor(id);

    // Paystack really does send this callback twice.
    const second = await awardPartnerCommission(id);
    expect(second.awarded).toBe(false);
    expect(await earningsFor(id)).toHaveLength(before.length);
  });

  it("does not let a ₦0 activation consume the first commission", async () => {
    await clearLedger();
    // An admin setting the plan by hand, or a 100% discount: a successful
    // payment of nothing, recorded before any money arrives.
    await pay({
      amount: 0,
      months: 1,
      paidAt: new Date("2026-01-01T09:00:00Z"),
      gateway: "admin",
    });
    const real = await pay({
      amount: MONTHLY,
      months: 1,
      paidAt: new Date("2026-02-01T09:00:00Z"),
    });

    const rows = await earningsFor(real);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("first");
  });

  it("carries on from the months a church has already paid for", async () => {
    await clearLedger();
    await pay({
      amount: MONTHLY,
      months: 1,
      paidAt: new Date("2026-01-01T09:00:00Z"),
    });
    const annual = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-02-01T09:00:00Z"),
    });

    const rows = await earningsFor(annual);
    // Month one is spent, so the year covers months 2–13: the second
    // commission now, and eleven months of trail.
    expect(rows.map((r) => r.kind).sort()).toEqual(["second", "trail"]);
    const trail = rows.find((r) => r.kind === "trail")!;
    expect(trail.note).toMatch(/months 3–13 of a 12-month payment/);
  });

  it("stops at the end of the trail window on the second year", async () => {
    await clearLedger();
    await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-01-05T10:00:00Z"),
    });
    const renewal = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2027-01-05T10:00:00Z"),
    });

    const rows = await earningsFor(renewal);
    // Months 13–24, of which only 13 and 14 are inside a 12-month trail.
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("trail");
    expect(rows[0].note).toMatch(/months 13–14 of a 12-month payment/);
  });

  it("orders two payments that share a timestamp, instead of hoping", async () => {
    await clearLedger();
    const when = new Date("2026-03-01T12:00:00Z");
    const a = await pay({ amount: MONTHLY, months: 1, paidAt: when });
    const b = await pay({ amount: MONTHLY, months: 1, paidAt: when });

    const kinds = [
      ...(await earningsFor(a)).map((r) => r.kind),
      ...(await earningsFor(b)).map((r) => r.kind),
    ].sort();
    /*
     * Exactly one first and one second, whichever way the ids fall. With a
     * `<=` comparison both rows counted each other and both came out as the
     * second payment; with a plain `<` neither did and both claimed the first.
     */
    expect(kinds).toEqual(["first", "second"]);
  });

  it("pays a suspended Partner nothing, even on a year", async () => {
    await clearLedger();
    await db
      .update(partner)
      .set({ status: "suspended" })
      .where(eq(partner.id, partnerId));

    const id = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-06-01T10:00:00Z"),
    });
    expect(await earningsFor(id)).toHaveLength(0);

    await db
      .update(partner)
      .set({ status: "active" })
      .where(eq(partner.id, partnerId));
  });

  it("counts only this church's months, not the whole platform's", async () => {
    /*
     * The guard on the WHERE clause. The sum of months paid has to be scoped
     * to THIS church: unscoped, every other church's history would push this
     * one's first payment past the end of the trail window, and a Partner's
     * first church would earn the full commission while their hundredth
     * earned nothing — with no error anywhere.
     *
     * So another church pays for two years first, and this church's year must
     * still be its own months 1–12.
     */
    await clearLedger();
    await db.insert(church).values({
      id: OTHER_CHURCH_ID,
      name: "Another Check Church",
      slug: `zzcheck-other-${STAMP}`,
      plan: "growth",
      status: "active",
    });
    await db.insert(payment).values(
      [0, 1].map((i) => ({
        churchId: OTHER_CHURCH_ID,
        plan: "growth" as const,
        amount: ANNUAL,
        currency: "NGN",
        gateway: "paystack",
        reference: `zzcheck-other-${STAMP}-${i}`,
        status: "success" as const,
        periodMonths: 12,
        paidAt: new Date(`202${5 + i}-01-05T10:00:00Z`),
      })),
    );

    const id = await pay({
      amount: ANNUAL,
      months: 12,
      paidAt: new Date("2026-01-05T10:00:00Z"),
    });
    const kinds = (await earningsFor(id)).map((r) => r.kind).sort();
    expect(kinds).toEqual(["first", "second", "trail"]);
  });
});

/* ============================================================
 * The October audit: what the month count, the base and the tier must not do
 * ========================================================== */

describe("a payment recorded late with an earlier date", () => {
  it("does not earn the first commission a second time", async () => {
    /*
     * The church pays month one by transfer on 1 September, but nobody records
     * it until 10 November — after the card payments of 5 October ("first")
     * and 5 November ("second") have already been awarded. Counted by its
     * date alone, the transfer had nothing before it, was priced as month one,
     * and earned the first commission again. It is the church's third month
     * paid for, and it earns the trail.
     */
    await clearLedger();
    const oct = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-10-05T10:00:00Z") });
    const nov = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-11-05T10:00:00Z") });
    const sep = await pay({
      amount: MONTHLY,
      months: 1,
      paidAt: new Date("2026-09-01T12:00:00Z"),
      gateway: "bank_transfer",
    });

    expect((await earningsFor(oct)).map((r) => r.kind)).toEqual(["first"]);
    expect((await earningsFor(nov)).map((r) => r.kind)).toEqual(["second"]);
    expect((await earningsFor(sep)).map((r) => r.kind)).toEqual(["trail"]);
    expect(await churchKinds()).toEqual(["first", "second", "trail"]);
  });

  it("still counts a transfer recorded before a slow card checkout completes", async () => {
    /*
     * The other order: a card checkout STARTED on day 1 (the row is written
     * then, pending) completes on day 6, after a transfer was recorded on
     * day 5. Counted by when rows were written alone, the card payment had
     * nothing before it and claimed the first commission the transfer had
     * already earned.
     */
    await clearLedger();
    const [card] = await db
      .insert(payment)
      .values({
        churchId: CHURCH_ID,
        plan: "growth",
        amount: MONTHLY,
        currency: "NGN",
        gateway: "paystack",
        reference: `zzcheck-${STAMP}-slow-${Math.random().toString(36).slice(2, 8)}`,
        status: "pending",
        periodMonths: 1,
      })
      .returning({ id: payment.id });
    const transfer = await pay({
      amount: MONTHLY,
      months: 1,
      paidAt: new Date("2026-04-05T12:00:00Z"),
      gateway: "bank_transfer",
    });
    await db
      .update(payment)
      .set({ status: "success", paidAt: new Date("2026-04-06T09:00:00Z") })
      .where(eq(payment.id, card.id));
    await awardPartnerCommission(card.id);

    expect((await earningsFor(transfer)).map((r) => r.kind)).toEqual(["first"]);
    expect((await earningsFor(card.id)).map((r) => r.kind)).toEqual(["second"]);
  });

  /*
   * The two orders disagree about this pair, and BOTH are already successful
   * when the awards run: a card checkout written on day 1 and paid on day 6,
   * and a transfer written and paid on day 5. That happens when two awards run
   * back to back after both commits, or when one award errored and the sweep
   * retries it later. "Either order says earlier" counted each in the other,
   * priced both as month two, and the first commission went to nobody. The
   * tie-break is the order they were priced in, so exactly one counts the
   * other — whichever is awarded first.
   */
  async function disagreeingPair() {
    await clearLedger();
    const write = async (createdAt: string, paidAt: string, gateway: string) => {
      const [row] = await db
        .insert(payment)
        .values({
          churchId: CHURCH_ID,
          plan: "growth",
          amount: MONTHLY,
          currency: "NGN",
          gateway,
          reference: `zzcheck-${STAMP}-pair-${Math.random().toString(36).slice(2, 8)}`,
          status: "success",
          periodMonths: 1,
          createdAt: new Date(createdAt),
          paidAt: new Date(paidAt),
        })
        .returning({ id: payment.id });
      return row.id;
    };
    const card = await write("2026-03-01T09:00:00Z", "2026-03-06T09:00:00Z", "paystack");
    const transfer = await write("2026-03-05T09:00:00Z", "2026-03-05T12:00:00Z", "bank_transfer");
    return { card, transfer };
  }

  it("pays exactly one first and one second when both succeed before either is priced (card first)", async () => {
    const { card, transfer } = await disagreeingPair();
    await awardPartnerCommission(card);
    await awardPartnerCommission(transfer);
    expect((await earningsFor(card)).map((r) => r.kind)).toEqual(["first"]);
    expect((await earningsFor(transfer)).map((r) => r.kind)).toEqual(["second"]);
    expect(await churchKinds()).toEqual(["first", "second"]);
  });

  it("pays exactly one first and one second when both succeed before either is priced (transfer first)", async () => {
    const { card, transfer } = await disagreeingPair();
    await awardPartnerCommission(transfer);
    await awardPartnerCommission(card);
    expect((await earningsFor(transfer)).map((r) => r.kind)).toEqual(["first"]);
    expect((await earningsFor(card)).map((r) => r.kind)).toEqual(["second"]);
    expect(await churchKinds()).toEqual(["first", "second"]);
  });

  it("pays exactly one first and one second when the two awards race", async () => {
    // Serialised by the referral-row lock; whichever gets it first is "first".
    const { card, transfer } = await disagreeingPair();
    await Promise.all([awardPartnerCommission(card), awardPartnerCommission(transfer)]);
    expect(await churchKinds()).toEqual(["first", "second"]);
  });

  it("prices a payment once, even when it is replayed after a later one", async () => {
    // A replayed callback for the first payment, arriving after the second was
    // awarded, used to count the second too and add a "second" to the first.
    await clearLedger();
    const a = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-05-01T09:00:00Z") });
    await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-06-01T09:00:00Z") });
    const replay = await awardPartnerCommission(a);
    expect(replay.awarded).toBe(false);
    expect((await earningsFor(a)).map((r) => r.kind)).toEqual(["first"]);
    expect(await churchKinds()).toEqual(["first", "second"]);
  });
});

describe("the commission base", () => {
  it("pays on the plan price, not the international card surcharge", async () => {
    // ₦14,000 charged: ₦10,000 of Growth and ₦4,000 of surcharge and rounding.
    await clearLedger();
    const id = await pay({
      amount: 14_000,
      surchargeAmount: 4000,
      months: 1,
      paidAt: new Date("2026-07-01T09:00:00Z"),
    });
    const [first] = await earningsFor(id);
    expect(first.kind).toBe("first");
    expect(Number(first.amount)).toBe(Math.round(10_000 * base.firstBps) / 10_000);
  });
});

describe("the churches that count towards a tier", () => {
  it("counts a year paid months ago, and not a ₦0 activation", async () => {
    await clearLedger();
    await db.delete(payment).where(inArray(payment.churchId, TIER_CHURCHES));
    await db
      .insert(church)
      .values(
        TIER_CHURCHES.map((id, i) => ({
          id,
          name: `Tier Check ${i}`,
          slug: id,
          plan: "growth" as const,
          status: "active" as const,
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(partnerReferral)
      .values(TIER_CHURCHES.map((churchId) => ({ partnerId, churchId, source: "link" })))
      .onConflictDoNothing();

    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
    // 0: a year, paid 120 days ago — still paying today. COUNTS.
    await pay({ churchId: TIER_CHURCHES[0], amount: ANNUAL, months: 12, paidAt: daysAgo(120), award: false });
    // 1: one month, paid 150 days ago — lapsed. Does not count.
    await pay({ churchId: TIER_CHURCHES[1], amount: MONTHLY, months: 1, paidAt: daysAgo(150), award: false });
    // 2: a "year" set by hand for ₦0 — not paying. Does not count.
    await pay({ churchId: TIER_CHURCHES[2], amount: 0, months: 12, paidAt: daysAgo(5), gateway: "admin", award: false });
    // 3: one month, paid last week. COUNTS.
    await pay({ churchId: TIER_CHURCHES[3], amount: MONTHLY, months: 1, paidAt: daysAgo(7), award: false });

    expect(await livePayingChurches(partnerId, rates)).toBe(2);
  });
});

describe("reversing the commission on a voided payment", () => {
  async function voidIt(id: string) {
    await db
      .update(payment)
      .set({ status: "failed", note: "Voided: zzcheck" })
      .where(eq(payment.id, id));
  }

  it("cancels an earning still in the wallet, and lets the next payment be the first", async () => {
    await clearLedger();
    const bounced = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-08-01T09:00:00Z") });
    await voidIt(bounced);
    const res = await reversePartnerCommission(bounced);
    expect(res).toMatchObject({ ok: true, cancelled: 1, clawedBack: 0 });

    const rows = await db
      .select({ status: partnerEarning.status })
      .from(partnerEarning)
      .where(eq(partnerEarning.paymentId, bounced));
    expect(rows.map((r) => r.status)).toEqual(["cancelled"]);

    // The bounced transfer bought nothing, so the real one is month one.
    const real = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-08-03T09:00:00Z") });
    expect((await earningsFor(real)).map((r) => r.kind)).toEqual(["first"]);
  });

  it("owes back money already withdrawn, once, as a negative row", async () => {
    await clearLedger();
    await db.delete(partnerPayout).where(eq(partnerPayout.partnerId, partnerId));
    const id = await pay({ amount: MONTHLY, months: 1, paidAt: new Date("2026-09-01T09:00:00Z") });
    const [earned] = await earningsFor(id);

    // The earning went out in a withdrawal that was paid.
    const [payout] = await db
      .insert(partnerPayout)
      .values({ partnerId, amount: Number(earned.amount), currency: "NGN", status: "paid" })
      .returning({ id: partnerPayout.id });
    await db
      .update(partnerEarning)
      .set({ payoutId: payout.id, status: "paid" })
      .where(eq(partnerEarning.paymentId, id));

    await voidIt(id);
    const res = await reversePartnerCommission(id);
    expect(res).toMatchObject({ ok: true, cancelled: 0, clawedBack: Number(earned.amount) });

    const rows = await db
      .select({ kind: partnerEarning.kind, amount: partnerEarning.amount, status: partnerEarning.status })
      .from(partnerEarning)
      .where(eq(partnerEarning.paymentId, id));
    const reversal = rows.find((r) => r.kind === "reversal");
    expect(Number(reversal?.amount)).toBe(-Number(earned.amount));
    expect(reversal?.status).toBe("available");
    // The paid row is history and stays exactly as it was.
    expect(rows.find((r) => r.kind === "first")?.status).toBe("paid");

    // Called again — a retry, a double click — it changes nothing.
    const again = await reversePartnerCommission(id);
    expect(again).toMatchObject({ ok: true, already: true });
    const after = await db
      .select({ id: partnerEarning.id })
      .from(partnerEarning)
      .where(and(eq(partnerEarning.paymentId, id), eq(partnerEarning.kind, "reversal")));
    expect(after).toHaveLength(1);
  });

  it("is refused by the database if a non-reversal row is negative", async () => {
    // partner_earning_sign_chk: a negative "first" would silently shrink a
    // withdrawal, because negative rows are taken as debts.
    await expect(
      db.insert(partnerEarning).values({
        partnerId,
        churchId: CHURCH_ID,
        kind: "first",
        amount: -100,
        currency: "NGN",
        rateBps: 0,
        status: "available",
      }),
    ).rejects.toThrow();
  });
});
