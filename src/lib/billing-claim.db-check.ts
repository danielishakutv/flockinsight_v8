/**
 * Database-backed checks for honouring a subscription payment exactly once.
 * Run with `pnpm test:db`.
 *
 * The callback, the Paystack webhook, the reconcile cron and a superadmin's
 * "mark received" can all try to honour the same payment at the same moment.
 * They used to each read "pending", mark it paid and extend the plan, so one
 * annual payment bought twenty-four months. The claim is now a conditional
 * UPDATE in the same transaction as the extension; these prove it under a
 * deliberately interleaved race on a single row, not a Promise.all that may
 * happen to serialise.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";

// Side effects after the commit are not under test here.
vi.mock("@/lib/audit", () => ({ auditSystem: async () => {}, audit: async () => {} }));
vi.mock("@/lib/partners", () => ({ awardPartnerCommission: async () => {} }));
vi.mock("@/lib/referrals", () => ({ awardReferralIfDue: async () => ({ ok: true }) }));

const { claimSubscriptionPayment, voidPaymentRecord } = await import("@/lib/billing");

const stamp = Date.now();
const CHURCH = `zzcheck-claim-${stamp}`;
const paymentIds: string[] = [];

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH,
    name: `ZZ Claim ${stamp}`,
    slug: `zzcheck-claim-${stamp}`,
    handle: `zzcheck-claim-${stamp}`,
    plan: "growth",
    trialEndsAt: null,
    planRenewsAt: null,
  });
});

afterAll(async () => {
  for (const id of paymentIds) await db.delete(payment).where(eq(payment.id, id));
  await db.delete(church).where(eq(church.id, CHURCH));
});

async function newPayment(months: number): Promise<string> {
  const [p] = await db
    .insert(payment)
    .values({
      churchId: CHURCH,
      plan: "growth",
      amount: 100_000,
      currency: "NGN",
      gateway: "paystack",
      reference: `FI-zzcheck-${stamp}-${paymentIds.length}`,
      status: "pending",
      periodMonths: months,
    })
    .returning({ id: payment.id });
  paymentIds.push(p.id);
  return p.id;
}

async function renewsAt(): Promise<Date | null> {
  const [c] = await db
    .select({ r: church.planRenewsAt })
    .from(church)
    .where(eq(church.id, CHURCH));
  return c?.r ?? null;
}

const opts = { allowFailed: true, convertRemaining: true, actorName: "zzcheck" };

describe("claimSubscriptionPayment", () => {
  it("extends the plan once when a second claim arrives mid-claim", async () => {
    await db.update(church).set({ planRenewsAt: null }).where(eq(church.id, CHURCH));
    const id = await newPayment(12);

    // T1 wins the row and holds its transaction open, as a slow claim would.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let took!: () => void;
    const taken = new Promise<void>((r) => (took = r));
    const t1 = db.transaction(async (tx) => {
      const won = await tx
        .update(payment)
        .set({ status: "success", paidAt: new Date() })
        .where(and(eq(payment.id, id), eq(payment.status, "pending")))
        .returning({ id: payment.id });
      took();
      await held;
      return won.length;
    });
    await taken;
    // T2 is the real claim, started while T1 is uncommitted. Its UPDATE waits
    // for T1's row lock, then re-checks "pending" against the committed row.
    const t2 = claimSubscriptionPayment(id, opts);
    await new Promise((r) => setTimeout(r, 300));
    release();
    const [won1, claimed2] = await Promise.all([t1, t2]);

    expect(won1).toBe(1);
    expect(claimed2).toBeNull();
    // T1 was a bare status change, so nothing extended: proof T2 did not.
    expect(await renewsAt()).toBeNull();
  });

  it("extends by exactly the months bought when many claims race", async () => {
    await db.update(church).set({ planRenewsAt: null }).where(eq(church.id, CHURCH));
    const id = await newPayment(12);
    const before = Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimSubscriptionPayment(id, opts)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);

    const r = (await renewsAt())!;
    const expected = new Date(before);
    expected.setMonth(expected.getMonth() + 12);
    // Twelve months, not twenty-four (allow the seconds the test took).
    expect(Math.abs(r.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  it("never honours a voided row, whatever arrives later", async () => {
    const id = await newPayment(1);
    await db
      .update(payment)
      .set({ status: "failed", note: "Voided: zzcheck" })
      .where(eq(payment.id, id));
    const before = await renewsAt();
    expect(await claimSubscriptionPayment(id, opts)).toBeNull();
    expect(await renewsAt()).toEqual(before);
  });
});

/*
 * The void and the claim take the same two locks in the same order (payment,
 * then church), so whichever goes second sees the other's committed result.
 * These race them on ONE row with the first transaction deliberately held
 * open, and check the void takes back exactly what the claim gave.
 */
describe("voidPaymentRecord", () => {
  it("a claim that arrives while a void holds the row claims nothing", async () => {
    const start = new Date(Date.now() + 30 * 86_400_000);
    await db.update(church).set({ planRenewsAt: start }).where(eq(church.id, CHURCH));
    const id = await newPayment(12);

    // T1 is the void's first half: lock the row and mark it voided, then wait.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let took!: () => void;
    const taken = new Promise<void>((r) => (took = r));
    const t1 = db.transaction(async (tx) => {
      await tx.select({ id: payment.id }).from(payment).where(eq(payment.id, id)).for("update");
      await tx
        .update(payment)
        .set({ status: "failed", note: "Voided: zzcheck race" })
        .where(eq(payment.id, id));
      took();
      await held;
    });
    await taken;
    // The claim starts while the void is uncommitted; its UPDATE waits on the
    // row lock, then re-reads a row that is failed AND voided.
    const t2 = claimSubscriptionPayment(id, opts);
    await new Promise((r) => setTimeout(r, 300));
    release();
    const [, claimed] = await Promise.all([t1, t2]);

    expect(claimed).toBeNull();
    expect((await renewsAt())?.getTime()).toBe(start.getTime());
    const [row] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.id, id));
    expect(row.status).toBe("failed");
  });

  it("winds back exactly the months the voided payment added", async () => {
    const start = new Date(Date.now() + 30 * 86_400_000);
    await db.update(church).set({ planRenewsAt: start }).where(eq(church.id, CHURCH));
    const id = await newPayment(12);

    const claimed = await claimSubscriptionPayment(id, opts);
    expect(claimed).not.toBeNull();
    const extended = (await renewsAt())!;
    const twelveOn = new Date(start);
    twelveOn.setMonth(twelveOn.getMonth() + 12);
    expect(extended.getTime()).toBe(twelveOn.getTime());

    const out = await voidPaymentRecord(id, "zzcheck refund");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.v.wasSuccess).toBe(true);
      expect(out.v.months).toBe(12);
    }
    expect((await renewsAt())?.getTime()).toBe(start.getTime());

    // And it stays voided: a late webhook claims nothing.
    expect(await claimSubscriptionPayment(id, opts)).toBeNull();
    expect((await renewsAt())?.getTime()).toBe(start.getTime());
  });

  it("refuses a second void of the same row", async () => {
    const id = await newPayment(1);
    expect((await voidPaymentRecord(id, "zzcheck once")).ok).toBe(true);
    const again = await voidPaymentRecord(id, "zzcheck twice");
    expect(again.ok).toBe(false);
  });
});
