/**
 * Database-backed checks for the giving → Finance mirror. Run with
 * `pnpm test:db`.
 *
 * Three things only a real Postgres can show:
 *
 *  1. Unlinking a fund keeps every row in it. The rows used to stay tied to
 *     their gifts, so the next edit of an old gift deleted its row from the
 *     former fund ("no fund any more"), and the balance eroded one correction
 *     at a time against a promise that nothing would be deleted.
 *  2. One gift has at most one shadow, even when the sync and the fund
 *     backfill race. Both read before they write; under READ COMMITTED the
 *     only thing that can stop the second write is the unique index on
 *     finance_transaction.giving_id. Proved with a deliberately held
 *     transaction over ONE gift — Promise.all that happens to serialise
 *     passes whether the bug is there or not.
 *  3. The finance-accounts and projects exports reconcile with the screen.
 *
 * Owns its fixtures: one church, "zzcheck-…", created here and removed by id
 * at the end (its rows cascade with it). Nothing it did not make is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  financeAccount,
  financeTransaction,
  financeTransfer,
  giving,
  givingCategory,
  pledge,
  project,
} from "@/db/schema";
import {
  backfillFund,
  syncGivingToFinance,
  unlinkFundAccount,
} from "@/lib/finance-giving-sync";
import { listAccounts } from "@/lib/finance-data";
import { listProjects } from "@/lib/projects";
import { buildDataset } from "@/lib/report-data";

const STAMP = Date.now().toString(36);
const churchId = `zzcheck-fgl-${STAMP}`;

async function shadowsOf(givingId: string) {
  return db
    .select({
      id: financeTransaction.id,
      accountId: financeTransaction.accountId,
      givingId: financeTransaction.givingId,
      amount: financeTransaction.amount,
    })
    .from(financeTransaction)
    .where(
      and(
        eq(financeTransaction.churchId, churchId),
        eq(financeTransaction.givingId, givingId),
      ),
    );
}

async function rowsInAccount(accountId: string) {
  return db
    .select({ id: financeTransaction.id, givingId: financeTransaction.givingId })
    .from(financeTransaction)
    .where(
      and(
        eq(financeTransaction.churchId, churchId),
        eq(financeTransaction.accountId, accountId),
      ),
    );
}

async function category(name: string) {
  const [c] = await db
    .insert(givingCategory)
    .values({ churchId, name: `zzcheck ${name} ${STAMP}` })
    .returning({ id: givingCategory.id, name: givingCategory.name });
  return c;
}

async function fund(categoryId: string, name: string) {
  const [a] = await db
    .insert(financeAccount)
    .values({
      churchId,
      name: `zzcheck ${name} ${STAMP}`,
      type: "other",
      givingCategoryId: categoryId,
    })
    .returning({ id: financeAccount.id });
  return a.id;
}

async function gift(categoryId: string | null, amount: number, date = "2026-03-01") {
  const [g] = await db
    .insert(giving)
    .values({ churchId, categoryId, amount, date, giverName: "zzcheck giver" })
    .returning({ id: giving.id });
  return g.id;
}

beforeAll(async () => {
  await db.insert(church).values({
    id: churchId,
    name: "zzcheck Finance Giving Ledger",
    slug: churchId,
    currency: "NGN",
    country: "Nigeria",
  });
});

afterAll(async () => {
  // By id only. giving, finance_* and project rows cascade with the church.
  await db.delete(church).where(eq(church.id, churchId));
});

describe("unlinking a fund keeps its history", () => {
  it("an edit to an old gift after the unlink deletes nothing", async () => {
    const cat = await category("Building");
    const g1 = await gift(cat.id, 50000);
    const g2 = await gift(cat.id, 20000);
    const fundId = await fund(cat.id, "Building Fund");
    expect(await backfillFund(churchId, cat.id, fundId, cat.name)).toBe(2);

    const unlinked = await unlinkFundAccount(churchId, fundId);
    expect(unlinked?.detached).toBe(2);

    // A typo fixed on last year's gift, then the sync every save runs.
    await db.update(giving).set({ note: "corrected" }).where(eq(giving.id, g1));
    await syncGivingToFinance(churchId, g1);
    // And a gift removed outright: the FK cascade must not reach the books.
    await db.delete(giving).where(eq(giving.id, g2));

    const rows = await rowsInAccount(fundId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.givingId === null)).toBe(true);
    const acct = (await listAccounts(churchId)).find((a) => a.id === fundId)!;
    expect(acct.income).toBe(70000);

    // Linking the category again builds a complete new fund, not one with gaps.
    const again = await fund(cat.id, "Building Fund 2");
    expect(await backfillFund(churchId, cat.id, again, cat.name)).toBe(1); // g1; g2 is gone
    expect(await shadowsOf(g1)).toHaveLength(1);
  });

  it("a fund whose category was deleted keeps its rows too", async () => {
    const cat = await category("Welfare");
    const fundId = await fund(cat.id, "Welfare Fund");
    const g = await gift(cat.id, 9000);
    await syncGivingToFinance(churchId, g);
    expect(await shadowsOf(g)).toHaveLength(1);

    // What deleting the category does through its FKs (both set null).
    await db
      .update(financeAccount)
      .set({ givingCategoryId: null })
      .where(eq(financeAccount.id, fundId));
    await db.update(giving).set({ categoryId: null }).where(eq(giving.id, g));
    await syncGivingToFinance(churchId, g);

    const rows = await rowsInAccount(fundId);
    expect(rows).toHaveLength(1);
    expect(rows[0].givingId).toBeNull();
  });

  it("moving a gift out of a still-linked fund still removes its shadow", async () => {
    const cat = await category("Missions");
    const fundId = await fund(cat.id, "Missions Fund");
    const g = await gift(cat.id, 3000);
    await syncGivingToFinance(churchId, g);
    await db.update(giving).set({ categoryId: null }).where(eq(giving.id, g));
    await syncGivingToFinance(churchId, g);
    expect(await shadowsOf(g)).toHaveLength(0);
    expect(await rowsInAccount(fundId)).toHaveLength(0);
  });
});

describe("one gift, one shadow, however the writes interleave", () => {
  /**
   * Hold a transaction that has written a shadow for `givingId` but not yet
   * committed, run `contender` against the same gift, then commit. Under
   * READ COMMITTED the contender cannot see the held row; only the unique
   * index makes it wait and then defer to it.
   */
  async function race(givingId: string, accountId: string, contender: () => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let written!: () => void;
    const wrote = new Promise<void>((r) => (written = r));
    const held = db.transaction(async (tx) => {
      await tx.insert(financeTransaction).values({
        churchId,
        givingId,
        kind: "income",
        amount: 1,
        date: "2026-03-01",
        accountId,
      });
      written();
      await gate;
    });
    await wrote;
    const contending = contender();
    // Long enough for the contender to reach the index and block on it.
    await new Promise((r) => setTimeout(r, 400));
    release();
    await held;
    return contending;
  }

  it("the sync defers to a shadow committed under it", async () => {
    const cat = await category("Race sync");
    const fundId = await fund(cat.id, "Race sync fund");
    const g = await gift(cat.id, 777);
    await race(g, fundId, () => syncGivingToFinance(churchId, g));
    const rows = await shadowsOf(g);
    expect(rows).toHaveLength(1);
    // The sync's upsert ran after the held insert and brought it in line.
    expect(Number(rows[0].amount)).toBe(777);
  });

  it("the backfill defers to a shadow committed under it", async () => {
    const cat = await category("Race backfill");
    const fundId = await fund(cat.id, "Race backfill fund");
    const g = await gift(cat.id, 555);
    const created = await race(g, fundId, () =>
      backfillFund(churchId, cat.id, fundId, cat.name),
    );
    expect(created).toBe(0);
    expect(await shadowsOf(g)).toHaveLength(1);
  });
});

describe("exports that reconcile", () => {
  it("each finance-accounts row adds up to its balance", async () => {
    const [a] = await db
      .insert(financeAccount)
      .values({ churchId, name: `zzcheck Main ${STAMP}`, type: "bank", openingBalance: 1000 })
      .returning({ id: financeAccount.id });
    const [b] = await db
      .insert(financeAccount)
      .values({ churchId, name: `zzcheck Petty ${STAMP}`, type: "cash" })
      .returning({ id: financeAccount.id });
    await db.insert(financeTransaction).values({
      churchId,
      kind: "income",
      amount: 100000,
      date: "2026-03-02",
      accountId: a.id,
    });
    await db.insert(financeTransfer).values({
      churchId,
      fromAccountId: a.id,
      toAccountId: b.id,
      amount: 20000,
      date: "2026-03-03",
    });

    const out = await buildDataset("finance-accounts", churchId, { from: null, to: null });
    const col = (name: string) => out.columns.indexOf(name);
    for (const row of out.rows) {
      const n = (c: string) => Number(row[col(c)] ?? 0);
      expect(
        n("opening_balance") + n("total_in") + n("transferred_in") - n("total_out") - n("transferred_out"),
      ).toBeCloseTo(n("balance"), 2);
    }
  });

  it("projects pledged_amount leaves out cancelled pledges, as the screen does", async () => {
    const [p] = await db
      .insert(project)
      .values({ churchId, name: `zzcheck Roof ${STAMP}` })
      .returning({ id: project.id });
    await db.insert(pledge).values([
      { churchId, projectId: p.id, giverName: "zzcheck A", amount: 10000 },
      { churchId, projectId: p.id, giverName: "zzcheck B", amount: 5000, status: "cancelled" },
    ]);
    const out = await buildDataset("projects", churchId, { from: null, to: null });
    const idCol = out.columns.indexOf("project_id");
    const pledgedCol = out.columns.indexOf("pledged_amount");
    const row = out.rows.find((r) => r[idCol] === p.id)!;
    const screen = (await listProjects(churchId)).find((x) => x.id === p.id)!;
    expect(Number(row[pledgedCol])).toBe(10000);
    expect(Number(row[pledgedCol])).toBe(screen.pledged);
  });
});
