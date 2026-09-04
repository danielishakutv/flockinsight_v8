/**
 * Database-backed checks for giving funds. Run with `pnpm test:db`.
 *
 * These exercise the part that is easy to get wrong and impossible to verify
 * by reading: a gift's shadow row in its category's fund, and what happens to
 * it when the gift changes, moves category, or goes away.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  financeAccount,
  financeCategory,
  financeTransaction,
  financeTransfer,
  giving,
  givingCategory,
} from "@/db/schema";
import {
  backfillFund,
  backfillPreview,
  fundAccountFor,
  syncGivingToFinance,
} from "@/lib/finance-giving-sync";
import { listAccounts } from "@/lib/finance-data";

let churchId = "";
let catA = "";
let catB = "";
let fundId = "";
const givingIds: string[] = [];

const stamp = Date.now();

beforeAll(async () => {
  const [c] = await db.select({ id: church.id }).from(church).limit(1);
  churchId = c.id;

  const [a] = await db
    .insert(givingCategory)
    .values({ churchId, name: `ZZ Building ${stamp}` })
    .returning({ id: givingCategory.id });
  const [b] = await db
    .insert(givingCategory)
    .values({ churchId, name: `ZZ Welfare ${stamp}` })
    .returning({ id: givingCategory.id });
  catA = a.id;
  catB = b.id;

  // Three gifts in category A, recorded BEFORE any fund exists — this is the
  // real-world case: a church that has been running for years.
  const rows = await db
    .insert(giving)
    .values([
      { churchId, categoryId: catA, amount: 50000, date: "2026-01-05", giverName: "Ada" },
      { churchId, categoryId: catA, amount: 25000.5, date: "2026-02-05", giverName: "Bola" },
      { churchId, categoryId: catA, amount: 10000, date: "2026-03-05", giverName: "Chidi" },
    ])
    .returning({ id: giving.id });
  givingIds.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  // Only rows this file created. An earlier version cleared every finance
  // transaction for the church, which is both wrong here and the kind of
  // unscoped delete that must never exist in a file someone might point at a
  // real database.
  if (fundId)
    await db
      .delete(financeTransaction)
      .where(eq(financeTransaction.accountId, fundId));
  if (givingIds.length)
    await db
      .delete(financeTransaction)
      .where(inArray(financeTransaction.givingId, givingIds));
  if (givingIds.length)
    await db.delete(giving).where(inArray(giving.id, givingIds));
  await db
    .delete(financeAccount)
    .where(
      and(
        eq(financeAccount.churchId, churchId),
        inArray(financeAccount.givingCategoryId, [catA, catB]),
      ),
    );
  await db
    .delete(financeCategory)
    .where(
      and(
        eq(financeCategory.churchId, churchId),
        inArray(financeCategory.name, [
          `ZZ Building ${stamp}`,
          `ZZ Welfare ${stamp}`,
        ]),
      ),
    );
  await db.delete(givingCategory).where(inArray(givingCategory.id, [catA, catB]));
});

describe("linking a fund to a category that already has giving", () => {
  it("previews what the backfill would pull in", async () => {
    const preview = await backfillPreview(churchId, catA);
    expect(preview.count).toBe(3);
    expect(preview.total).toBe(85000.5);
  });

  it("backfills every past gift", async () => {
    const [account] = await db
      .insert(financeAccount)
      .values({
        churchId,
        name: `ZZ Building Fund ${stamp}`,
        type: "other",
        givingCategoryId: catA,
      })
      .returning({ id: financeAccount.id });
    fundId = account.id;

    const created = await backfillFund(
      churchId,
      catA,
      fundId,
      `ZZ Building ${stamp}`,
    );
    expect(created).toBe(3);

    const account_ = (await listAccounts(churchId)).find((a) => a.id === fundId)!;
    expect(account_.income).toBe(85000.5);
    expect(account_.balance).toBe(85000.5);
    expect(account_.givingCategoryId).toBe(catA);
  });

  it("is safe to run twice", async () => {
    const again = await backfillFund(
      churchId,
      catA,
      fundId,
      `ZZ Building ${stamp}`,
    );
    expect(again).toBe(0);
  });

  it("files the rows under a matching income category, not Uncategorised", async () => {
    const rows = await db
      .select({ categoryId: financeTransaction.categoryId })
      .from(financeTransaction)
      .where(eq(financeTransaction.accountId, fundId));
    expect(rows.every((r) => r.categoryId !== null)).toBe(true);
  });

  it("finds the fund by category", async () => {
    const fund = await fundAccountFor(churchId, catA);
    expect(fund?.id).toBe(fundId);
    expect(await fundAccountFor(churchId, catB)).toBeNull();
  });
});

describe("a gift's shadow row follows the gift", () => {
  it("appears for a gift recorded after the fund exists", async () => {
    const [row] = await db
      .insert(giving)
      .values({
        churchId,
        categoryId: catA,
        amount: 5000,
        date: "2026-04-01",
        giverName: "Dami",
      })
      .returning({ id: giving.id });
    givingIds.push(row.id);

    await syncGivingToFinance(churchId, row.id);

    const [shadow] = await db
      .select({ amount: financeTransaction.amount, party: financeTransaction.party })
      .from(financeTransaction)
      .where(eq(financeTransaction.givingId, row.id));
    expect(Number(shadow.amount)).toBe(5000);
    expect(shadow.party).toBe("Dami");
  });

  it("follows an edited amount", async () => {
    const id = givingIds[givingIds.length - 1];
    await db.update(giving).set({ amount: 7500 }).where(eq(giving.id, id));
    await syncGivingToFinance(churchId, id);

    const [shadow] = await db
      .select({ amount: financeTransaction.amount })
      .from(financeTransaction)
      .where(eq(financeTransaction.givingId, id));
    expect(Number(shadow.amount)).toBe(7500);
  });

  it("disappears when the gift moves to a category with no fund", async () => {
    // Not data loss: the gift is untouched, and the row only ever existed as
    // its reflection in a fund it no longer belongs to.
    const id = givingIds[givingIds.length - 1];
    await db.update(giving).set({ categoryId: catB }).where(eq(giving.id, id));
    await syncGivingToFinance(churchId, id);

    const rows = await db
      .select({ id: financeTransaction.id })
      .from(financeTransaction)
      .where(eq(financeTransaction.givingId, id));
    expect(rows).toHaveLength(0);
  });

  it("comes back when the gift returns to the funded category", async () => {
    const id = givingIds[givingIds.length - 1];
    await db.update(giving).set({ categoryId: catA }).where(eq(giving.id, id));
    await syncGivingToFinance(churchId, id);

    const rows = await db
      .select({ id: financeTransaction.id })
      .from(financeTransaction)
      .where(eq(financeTransaction.givingId, id));
    expect(rows).toHaveLength(1);
  });

  it("goes when the gift is deleted, by the foreign key's cascade", async () => {
    const id = givingIds.pop()!;
    await db.delete(giving).where(eq(giving.id, id));

    const rows = await db
      .select({ id: financeTransaction.id })
      .from(financeTransaction)
      .where(eq(financeTransaction.givingId, id));
    expect(rows).toHaveLength(0);

    // And the fund is back to the three backfilled gifts.
    const account = (await listAccounts(churchId)).find((a) => a.id === fundId)!;
    expect(account.income).toBe(85000.5);
  });
});

describe("transfers move balances without touching income or expense", () => {
  it("draws down the fund and credits the destination", async () => {
    const [plain] = await db
      .insert(financeAccount)
      .values({
        churchId,
        name: `ZZ Current ${stamp}`,
        type: "bank",
        openingBalance: 1000,
      })
      .returning({ id: financeAccount.id });

    await db.insert(financeTransfer).values({
      churchId,
      fromAccountId: fundId,
      toAccountId: plain.id,
      amount: 20000,
      date: "2026-05-01",
    });

    const accounts = await listAccounts(churchId);
    const fund = accounts.find((a) => a.id === fundId)!;
    const current = accounts.find((a) => a.id === plain.id)!;

    // The fund is drawn down, and Finance now shows what is genuinely left —
    // while the giving records behind it are untouched.
    expect(fund.transferredOut).toBe(20000);
    expect(fund.balance).toBe(65000.5); // 85,000.50 given, 20,000 moved out
    expect(fund.income).toBe(85000.5); // what was given has not changed

    expect(current.transferredIn).toBe(20000);
    expect(current.balance).toBe(21000); // 1,000 opening + 20,000 in

    // A transfer is not income and not expense on either side.
    expect(current.income).toBe(0);
    expect(fund.expense).toBe(0);

    await db.delete(financeTransfer).where(eq(financeTransfer.churchId, churchId));
    await db.delete(financeAccount).where(eq(financeAccount.id, plain.id));
  });
});
