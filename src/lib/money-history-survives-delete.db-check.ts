/**
 * Money records outlive the accounts they belong to. Run with `pnpm test:db`.
 *
 * `payment.church_id` used to be ON DELETE CASCADE, so deleting a church that
 * had paid erased what it paid: collected-this-year, revenue-by-month and the
 * Paystack references a dispute is settled against all changed backwards, and
 * the finance page's "Deleted church" label could never fire because the row
 * was gone. And user -> partner -> partner_earning / partner_payout cascaded,
 * so deleting a Partner's login erased commission still owed and the record of
 * payouts already sent.
 *
 * These prove the database itself now refuses to lose them, whatever code path
 * runs the delete. Every fixture is `zzcheck-` prefixed and removed by id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, partner, partnerEarning, partnerPayout, payment, user } from "@/db/schema";

const STAMP = Date.now().toString(36);
const CHURCH_ID = `zzcheck-paykeep-${STAMP}`;
const USER_ID = `zzcheck-partnerkeep-${STAMP}`;

let paymentId = "";
let partnerId = "";
let earningId = "";
let payoutId = "";

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH_ID,
    name: `ZZ Paykeep ${STAMP}`,
    slug: `zzcheck-paykeep-${STAMP}`,
    handle: `zzcheck-paykeep-${STAMP}`,
  });
  const [p] = await db
    .insert(payment)
    .values({
      churchId: CHURCH_ID,
      plan: "growth",
      amount: 120_000,
      currency: "NGN",
      gateway: "paystack",
      reference: `FI-zzcheck-paykeep-${STAMP}`,
      status: "success",
      paidAt: new Date(),
    })
    .returning({ id: payment.id });
  paymentId = p.id;

  await db.insert(user).values({
    id: USER_ID,
    name: "Partner Keep Check",
    email: `${USER_ID}@example.invalid`,
  });
  const [pa] = await db
    .insert(partner)
    .values({
      userId: USER_ID,
      code: `ZK${STAMP.toUpperCase().slice(-6)}`,
      displayName: "Partner Keep Check",
      status: "active",
    })
    .returning({ id: partner.id });
  partnerId = pa.id;
  const [e] = await db
    .insert(partnerEarning)
    .values({ partnerId, kind: "first", amount: 5000, currency: "NGN", status: "available" })
    .returning({ id: partnerEarning.id });
  earningId = e.id;
  const [po] = await db
    .insert(partnerPayout)
    .values({
      partnerId,
      amount: 5000,
      currency: "NGN",
      status: "paid",
      bankName: "Zenith Bank",
      bankAccountNumber: "0000000000",
      bankAccountName: "Keep Check",
    })
    .returning({ id: partnerPayout.id });
  payoutId = po.id;
});

afterAll(async () => {
  // Children first, by id, now that nothing cascades to them.
  if (paymentId) await db.delete(payment).where(eq(payment.id, paymentId));
  if (earningId) await db.delete(partnerEarning).where(eq(partnerEarning.id, earningId));
  if (payoutId) await db.delete(partnerPayout).where(eq(partnerPayout.id, payoutId));
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.delete(church).where(eq(church.id, CHURCH_ID));
});

describe("deleting a church", () => {
  it("keeps every payment it made, detached from the church", async () => {
    await db.delete(church).where(eq(church.id, CHURCH_ID));

    const [kept] = await db.select().from(payment).where(eq(payment.id, paymentId));
    expect(kept, "the payment was erased with its church").toBeDefined();
    expect(kept.churchId).toBeNull();
    expect(Number(kept.amount)).toBe(120_000);
    expect(kept.reference).toBe(`FI-zzcheck-paykeep-${STAMP}`);
    expect(kept.status).toBe("success");
  });
});

describe("deleting a Partner's login", () => {
  it("is refused while the Partner has earnings or payouts", async () => {
    // Not just "it threw": a dropped connection or some other constraint would
    // throw too and prove nothing. It must be Postgres's foreign-key refusal
    // (23503), from one of the two RESTRICT keys this file exists to guard.
    // drizzle wraps the driver's error, so the SQLSTATE is on its `cause`.
    let refusal: unknown;
    try {
      await db.delete(user).where(eq(user.id, USER_ID));
    } catch (e) {
      refusal = e;
    }
    expect(refusal, "the login was deleted along with money still on record").toBeDefined();
    const pg = ((refusal as { cause?: unknown }).cause ?? refusal) as {
      code?: string;
      constraint?: string;
    };
    expect(pg.code).toBe("23503");
    expect([
      "partner_earning_partner_id_partner_id_fk",
      "partner_payout_partner_id_partner_id_fk",
    ]).toContain(pg.constraint);

    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, USER_ID));
    expect(u).toBeDefined();
    const earnings = await db
      .select({ id: partnerEarning.id })
      .from(partnerEarning)
      .where(eq(partnerEarning.partnerId, partnerId));
    expect(earnings).toHaveLength(1);
    const payouts = await db
      .select({ id: partnerPayout.id })
      .from(partnerPayout)
      .where(eq(partnerPayout.partnerId, partnerId));
    expect(payouts).toHaveLength(1);
  });
});
