/**
 * Database-backed checks for Partner withdrawals. Run with `pnpm test:db`.
 *
 * `partners-shared.test.ts` covers the money RULES with no database — rates,
 * tiers, what may be withdrawn. This file exists for the one thing only a real
 * Postgres can answer: **what happens when two withdrawals arrive at once.**
 *
 * It was written because the first version of `requestPayout` was wrong and its
 * own docstring said otherwise. It did the select and the update inside one
 * transaction and claimed that made a double withdrawal impossible. It does
 * not. Postgres runs READ COMMITTED, so two transactions each select the same
 * unclaimed earnings, neither seeing the other's uncommitted write; both insert
 * a payout; the second UPDATE waits for the first to commit and then overwrites
 * `payout_id`. Two requests for one balance, a ledger pointing only at the
 * later one, and a human paying both.
 *
 * No unit test can see that — the thing under test is the isolation level. So:
 * two real connections, fired together, and a count afterwards.
 *
 * Cleans up by deleting the one fixture user it created, which cascades to the
 * partner and its ledger. Nothing it did not make can be reached.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { partner, partnerEarning, partnerPayout, user } from "@/db/schema";
import { partnerWallet, requestPayout } from "@/lib/partners";

/** Unique per run, so a crashed run cannot collide with the next one. */
const STAMP = Date.now().toString(36);
const USER_ID = `zzcheck-partner-${STAMP}`;

let partnerId = "";

/* Two payout ids for the interleaving check below. They need to exist, because
 * `partner_earning.payout_id` is written by hand there. */
const FAKE_PAYOUT_A = "00000000-0000-4000-8000-00000000000a";
const FAKE_PAYOUT_B = "00000000-0000-4000-8000-00000000000b";

const BANK = {
  name: "Zenith Bank",
  accountNumber: "0000000000",
  accountName: "Check Partner",
};

/** Four earnings of 5,000, so 20,000 is available and a 10,000 ask takes two. */
const EARNING = 5000;
const EARNINGS = 4;

async function refillLedger(count = EARNINGS) {
  await db.delete(partnerEarning).where(eq(partnerEarning.partnerId, partnerId));
  await db.delete(partnerPayout).where(eq(partnerPayout.partnerId, partnerId));
  await db.insert(partnerEarning).values(
    Array.from({ length: count }, () => ({
      partnerId,
      kind: "first" as const,
      amount: EARNING,
      currency: "NGN",
      rateBps: 4000,
      status: "available" as const,
    })),
  );
}

beforeAll(async () => {
  await db.insert(user).values({
    id: USER_ID,
    name: "Partner Check",
    email: `${USER_ID}@example.invalid`,
  });
  const [row] = await db
    .insert(partner)
    .values({
      userId: USER_ID,
      code: `ZZ${STAMP.toUpperCase().slice(-6)}`,
      displayName: "Partner Check",
      status: "active",
      phone: "08000000000",
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      bankName: BANK.name,
      bankAccountNumber: BANK.accountNumber,
      bankAccountName: BANK.accountName,
    })
    .returning({ id: partner.id });
  partnerId = row.id;
});

afterAll(async () => {
  // The user cascades to partner, which cascades to its earnings and payouts.
  if (partnerId) await db.delete(user).where(eq(user.id, USER_ID));
});

describe("requestPayout under concurrency", () => {
  it("pays one of two simultaneous requests and refuses the other", async () => {
    await refillLedger();

    /*
     * Both fired before either can finish: two pool connections, two real
     * transactions, overlapping in time. This is the whole file.
     */
    const [a, b] = await Promise.all([
      requestPayout({ partnerId, amount: 10000, bank: BANK, currency: "NGN" }),
      requestPayout({ partnerId, amount: 10000, bank: BANK, currency: "NGN" }),
    ]);

    const won = [a, b].filter((r) => r.ok);
    const lost = [a, b].filter((r) => !r.ok);
    expect(won, `both were accepted: ${JSON.stringify([a, b])}`).toHaveLength(1);
    expect(lost).toHaveLength(1);

    // One payout row, for 10,000 — not two, and not 20,000.
    const payouts = await db
      .select({ id: partnerPayout.id, amount: partnerPayout.amount })
      .from(partnerPayout)
      .where(eq(partnerPayout.partnerId, partnerId));
    expect(payouts).toHaveLength(1);
    expect(Number(payouts[0].amount)).toBe(10000);

    // And the ledger agrees: exactly two earnings claimed by that payout.
    const claimed = await db
      .select({ id: partnerEarning.id })
      .from(partnerEarning)
      .where(
        and(
          eq(partnerEarning.partnerId, partnerId),
          eq(partnerEarning.payoutId, payouts[0].id),
        ),
      );
    expect(claimed).toHaveLength(2);

    // The other two are still available to withdraw later.
    const free = await db
      .select({ id: partnerEarning.id })
      .from(partnerEarning)
      .where(
        and(
          eq(partnerEarning.partnerId, partnerId),
          isNull(partnerEarning.payoutId),
        ),
      );
    expect(free).toHaveLength(2);
  });

  it("never lets the sum of open payouts exceed what was earned", async () => {
    await refillLedger();

    // Five at once, each asking for the whole balance.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        requestPayout({ partnerId, amount: 20000, bank: BANK, currency: "NGN" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const payouts = await db
      .select({ amount: partnerPayout.amount })
      .from(partnerPayout)
      .where(eq(partnerPayout.partnerId, partnerId));
    const asked = payouts.reduce((sum, p) => sum + Number(p.amount), 0);
    expect(asked).toBeLessThanOrEqual(EARNING * EARNINGS);
  });

  it("refuses a second request while one is still open, and the wallet shows it held", async () => {
    await refillLedger();

    const first = await requestPayout({
      partnerId,
      amount: 10000,
      bank: BANK,
      currency: "NGN",
    });
    expect(first.ok).toBe(true);

    const second = await requestPayout({
      partnerId,
      amount: 5000,
      bank: BANK,
      currency: "NGN",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/waiting/i);

    /*
     * The money taken is no longer available, but it has not vanished either —
     * a Partner looking at their wallet must be able to see where it went.
     * This assertion is the reason `requested` exists: it used to read 20,000
     * available with 10,000 already requested.
     */
    const wallet = await partnerWallet(partnerId);
    expect(wallet.available).toBe(10000);
    expect(wallet.requested).toBe(10000);
    expect(wallet.lifetime).toBe(EARNING * EARNINGS);
  });

  it("keeps the index as the last line of defence", async () => {
    // Belt and braces: the application rule above is a query, this is the
    // database refusing on its own. If this disappears, the race comes back
    // for anything that inserts a payout without going through requestPayout.
    const res = await db.execute(
      sql`select indexdef from pg_indexes where indexname = 'partner_payout_one_open_idx'`,
    );
    const rows = (Array.isArray(res) ? res : res.rows) as { indexdef: string }[];
    const [idx] = rows;
    expect(idx?.indexdef, "migration 0102 has not been applied").toBeTruthy();
    expect(idx.indexdef).toMatch(/UNIQUE/i);
    expect(idx.indexdef).toMatch(/requested/);
  });
});

/* ============================================================
 * Why the lock is there
 *
 * The tests above fire concurrent requests and hope the two transactions
 * genuinely overlap. That is the real-world shape, but a concurrency test that
 * happens to serialise passes whether the bug is present or not — so it cannot
 * be the only evidence.
 *
 * This pair interleaves two transactions ON PURPOSE, against fixture rows, and
 * shows the isolation level doing the thing the first version of the code
 * assumed it would not: without `for update`, both transactions claim the same
 * earning, and the second write wins. Nothing here touches shipped code — it
 * runs the same select-then-update shape by hand, with and without the lock.
 * ========================================================== */

function defer() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Both transactions try to claim the same earning. Returns who got it. */
async function interleavedClaim(withLock: boolean) {
  const aSelected = defer();
  const bSelected = defer();
  const took: Record<string, string | null> = { A: null, B: null };

  async function claim(who: "A" | "B", payoutId: string) {
    await db.transaction(async (tx) => {
      const base = tx
        .select({ id: partnerEarning.id })
        .from(partnerEarning)
        .where(
          and(
            eq(partnerEarning.partnerId, partnerId),
            eq(partnerEarning.status, "available"),
            isNull(partnerEarning.payoutId),
          ),
        );
      const rows = withLock ? await base.for("update") : await base;

      if (who === "B") bSelected.resolve();

      if (who === "A") {
        aSelected.resolve();
        /*
         * Wait for B to have selected, so the two really do overlap — but only
         * for a moment. Under `for update` B's select BLOCKS until this
         * transaction commits, so waiting for it without a deadline would
         * deadlock the very case being tested.
         */
        await Promise.race([
          bSelected.promise,
          new Promise<void>((r) => setTimeout(r, 300)),
        ]);
      }

      if (!rows.length) return;
      const done = await tx
        .update(partnerEarning)
        .set({ payoutId })
        // Unconditional, exactly as the first version was.
        .where(eq(partnerEarning.id, rows[0].id))
        .returning({ id: partnerEarning.id });
      took[who] = done.length ? done[0].id : null;
    });
  }

  const a = claim("A", FAKE_PAYOUT_A);
  await aSelected.promise;
  // B only starts once A is holding its read, and signals once it has its own
  // — so the two reads provably overlap. Under `for update` B never gets to
  // signal, which is what A's deadline is for.
  const b = claim("B", FAKE_PAYOUT_B).finally(() => bSelected.resolve());
  await Promise.all([a, b]);
  return took;
}

describe("the isolation level, measured rather than assumed", () => {
  /*
   * ONE earning in the ledger, so there is nothing else either transaction
   * could legitimately take. With four rows the locked run correctly lets the
   * second transaction claim a DIFFERENT one, which is right and proves
   * nothing — the question is what happens when they want the same row.
   */
  it("lets two transactions claim the same earning when nothing is locked", async () => {
    await refillLedger(1);
    const took = await interleavedClaim(false);

    // The bug, reproduced: both wrote to the one row.
    expect(took.A).not.toBeNull();
    expect(took.B).toBe(took.A);

    /*
     * One of the two writes won and the other was overwritten — which one is
     * down to scheduling and is deliberately not asserted. The harm is that
     * both transactions believed they had claimed this money while the ledger
     * can only ever name one owner. In the real function each would also have
     * inserted a payout, so there would be two requests for one balance and a
     * human would have no way to see it from the rows.
     */
    const [row] = await db
      .select({ payoutId: partnerEarning.payoutId })
      .from(partnerEarning)
      .where(eq(partnerEarning.partnerId, partnerId));
    expect([FAKE_PAYOUT_A, FAKE_PAYOUT_B]).toContain(row.payoutId);
  });

  it("lets exactly one claim it when the rows are locked", async () => {
    await refillLedger(1);
    const took = await interleavedClaim(true);

    // The second transaction re-checks its own WHERE once the lock is
    // released, finds the row taken, and claims nothing.
    expect(took.A).not.toBeNull();
    expect(took.B).toBeNull();
  });
});

describe("requestPayout on its own", () => {
  it("takes whole earnings, oldest first, and never splits a row", async () => {
    await refillLedger();

    // Asking for 7,000 when rows are 5,000 each takes two whole rows (10,000):
    // the payout records what the ledger actually gave up, not what was typed.
    const res = await requestPayout({
      partnerId,
      amount: 7000,
      bank: BANK,
      currency: "NGN",
    });
    expect(res.ok).toBe(true);

    const [payout] = await db
      .select({ amount: partnerPayout.amount })
      .from(partnerPayout)
      .where(eq(partnerPayout.partnerId, partnerId));
    expect(Number(payout.amount)).toBe(10000);
  });

  it("refuses more than the balance", async () => {
    await refillLedger();
    const res = await requestPayout({
      partnerId,
      amount: 25000,
      bank: BANK,
      currency: "NGN",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/available balance/i);

    const payouts = await db
      .select({ id: partnerPayout.id })
      .from(partnerPayout)
      .where(eq(partnerPayout.partnerId, partnerId));
    expect(payouts).toHaveLength(0);
  });

  it("refuses when there is nothing to take", async () => {
    await db.delete(partnerEarning).where(eq(partnerEarning.partnerId, partnerId));
    await db.delete(partnerPayout).where(eq(partnerPayout.partnerId, partnerId));

    const res = await requestPayout({
      partnerId,
      amount: 1000,
      bank: BANK,
      currency: "NGN",
    });
    expect(res.ok).toBe(false);
  });
});
