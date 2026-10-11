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
 *   a timestamp each count the other, and both lost the first commission.
 *
 * Every row this file writes is a fixture it created, named with a `zzcheck-`
 * prefix, and it removes only those at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  partner,
  partnerEarning,
  partnerReferral,
  payment,
  user,
} from "@/db/schema";
import { awardPartnerCommission } from "@/lib/partners";
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
}): Promise<string> {
  const [row] = await db
    .insert(payment)
    .values({
      churchId: CHURCH_ID,
      plan: "growth",
      amount: opts.amount,
      currency: "NGN",
      gateway: opts.gateway ?? "paystack",
      reference: `zzcheck-${STAMP}-${Math.random().toString(36).slice(2, 10)}`,
      status: "success",
      periodMonths: opts.months,
      paidAt: opts.paidAt,
    })
    .returning({ id: payment.id });
  await awardPartnerCommission(row.id);
  return row.id;
}

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
  // Only the fixtures created above. The partner and its ledger cascade from
  // the user; the payments and the referral cascade from the church.
  await db.delete(payment).where(eq(payment.churchId, CHURCH_ID));
  await db.delete(payment).where(eq(payment.churchId, OTHER_CHURCH_ID));
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.delete(church).where(eq(church.id, CHURCH_ID));
  await db.delete(church).where(eq(church.id, OTHER_CHURCH_ID));
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
