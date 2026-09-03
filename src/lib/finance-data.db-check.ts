/**
 * TEMPORARY integration check — run against the local dev database, then moved
 * out of the suite. Not kept, because it needs a live Postgres and the rest of
 * the suite deliberately does not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  financeAccount,
  financeCategory,
  financeTransaction,
} from "@/db/schema";
import {
  activeAccountOptions,
  activeCategoryOptions,
  getFinanceExportRows,
  getFinanceSummary,
  getLedger,
  listAccounts,
  listCategories,
} from "@/lib/finance-data";
import { EMPTY_FINANCE_FILTERS } from "@/lib/finance-shared";

let churchId = "";
let otherChurchId = "";
const accountIds: string[] = [];
const categoryIds: string[] = [];
const txnIds: string[] = [];

beforeAll(async () => {
  const churches = await db.select({ id: church.id }).from(church).limit(2);
  churchId = churches[0].id;
  otherChurchId = churches[1]?.id ?? churches[0].id;

  const [bank] = await db
    .insert(financeAccount)
    .values({
      churchId,
      name: `ZZ Test Bank ${Date.now()}`,
      type: "bank",
      openingBalance: 100000,
    })
    .returning({ id: financeAccount.id });
  const [cash] = await db
    .insert(financeAccount)
    .values({
      churchId,
      name: `ZZ Test Cash ${Date.now()}`,
      type: "cash",
      openingBalance: 5000,
    })
    .returning({ id: financeAccount.id });
  accountIds.push(bank.id, cash.id);

  const [inc] = await db
    .insert(financeCategory)
    .values({ churchId, name: `ZZ Hall hire ${Date.now()}`, kind: "income" })
    .returning({ id: financeCategory.id });
  const [exp] = await db
    .insert(financeCategory)
    .values({ churchId, name: `ZZ Electricity ${Date.now()}`, kind: "expense" })
    .returning({ id: financeCategory.id });
  categoryIds.push(inc.id, exp.id);

  const rows = await db
    .insert(financeTransaction)
    .values([
      {
        churchId,
        kind: "income" as const,
        amount: 50000,
        date: "2026-03-10",
        accountId: bank.id,
        categoryId: inc.id,
        party: "Wedding hall hire",
        method: "transfer" as const,
      },
      {
        churchId,
        kind: "income" as const,
        amount: 25000.5,
        date: "2026-03-15",
        accountId: cash.id,
        categoryId: inc.id,
        party: "Book sales",
      },
      {
        churchId,
        kind: "expense" as const,
        amount: 18000,
        date: "2026-03-20",
        accountId: bank.id,
        categoryId: exp.id,
        party: "IKEDC",
        reference: "INV-99",
      },
      {
        churchId,
        kind: "expense" as const,
        amount: 2000.25,
        date: "2026-04-02",
        accountId: cash.id,
        categoryId: exp.id,
        party: "Generator diesel",
      },
    ])
    .returning({ id: financeTransaction.id });
  txnIds.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  // Only the rows this file created, addressed by their own primary keys.
  if (txnIds.length)
    await db.delete(financeTransaction).where(inArray(financeTransaction.id, txnIds));
  if (categoryIds.length)
    await db.delete(financeCategory).where(inArray(financeCategory.id, categoryIds));
  if (accountIds.length)
    await db.delete(financeAccount).where(inArray(financeAccount.id, accountIds));
});

describe("accounts", () => {
  it("computes a balance as opening + income - expense", async () => {
    const accounts = (await listAccounts(churchId)).filter((a) =>
      accountIds.includes(a.id),
    );
    const bank = accounts.find((a) => a.name.includes("Bank"))!;
    const cash = accounts.find((a) => a.name.includes("Cash"))!;

    // 100000 + 50000 - 18000
    expect(bank.balance).toBe(132000);
    expect(bank.income).toBe(50000);
    expect(bank.expense).toBe(18000);
    expect(bank.transactionCount).toBe(2);

    // 5000 + 25000.50 - 2000.25
    expect(cash.balance).toBe(28000.25);
  });

  it("offers only active accounts to the pickers", async () => {
    await db
      .update(financeAccount)
      .set({ isActive: false })
      .where(eq(financeAccount.id, accountIds[1]));
    const options = await activeAccountOptions(churchId);
    expect(options.map((o) => o.id)).toContain(accountIds[0]);
    expect(options.map((o) => o.id)).not.toContain(accountIds[1]);
    await db
      .update(financeAccount)
      .set({ isActive: true })
      .where(eq(financeAccount.id, accountIds[1]));
  });
});

describe("categories", () => {
  it("reports each category's total and use count", async () => {
    const cats = (await listCategories(churchId)).filter((c) =>
      categoryIds.includes(c.id),
    );
    const income = cats.find((c) => c.kind === "income")!;
    const expense = cats.find((c) => c.kind === "expense")!;
    expect(income.total).toBe(75000.5);
    expect(income.transactionCount).toBe(2);
    expect(expense.total).toBe(20000.25);
  });

  it("keeps both kinds available to the form", async () => {
    const options = (await activeCategoryOptions(churchId)).filter((c) =>
      categoryIds.includes(c.id),
    );
    expect(options.map((c) => c.kind).sort()).toEqual(["expense", "income"]);
  });
});

describe("ledger", () => {
  const only = { ...EMPTY_FINANCE_FILTERS, from: "2026-03-01", to: "2026-04-30" };

  it("totals income and expense across the whole match, not just the page", async () => {
    const page = await getLedger(churchId, only, 1, 2);
    expect(page.rows).toHaveLength(2); // page size
    expect(page.count).toBe(4); // but counts them all
    expect(page.income).toBe(75000.5);
    expect(page.expense).toBe(20000.25);
    expect(page.net).toBe(55000.25);
  });

  it("returns newest first", async () => {
    const page = await getLedger(churchId, only, 1, 10);
    const mine = page.rows.filter((r) => txnIds.includes(r.id));
    expect(mine[0].date >= mine[mine.length - 1].date).toBe(true);
  });

  it("filters by kind", async () => {
    const page = await getLedger(churchId, { ...only, kind: "expense" }, 1, 10);
    expect(page.count).toBe(2);
    expect(page.income).toBe(0);
    expect(page.expense).toBe(20000.25);
  });

  it("filters by account", async () => {
    const page = await getLedger(
      churchId,
      { ...only, accountId: accountIds[0] },
      1,
      10,
    );
    expect(page.count).toBe(2);
  });

  it("filters by date range", async () => {
    const page = await getLedger(
      churchId,
      { ...EMPTY_FINANCE_FILTERS, from: "2026-04-01", to: "2026-04-30" },
      1,
      10,
    );
    expect(page.count).toBe(1);
    expect(page.expense).toBe(2000.25);
  });

  it("searches the payee", async () => {
    const page = await getLedger(churchId, { ...only, q: "IKEDC" }, 1, 10);
    expect(page.count).toBe(1);
    expect(page.rows[0].party).toBe("IKEDC");
  });

  it("searches by amount", async () => {
    const page = await getLedger(churchId, { ...only, q: "18000" }, 1, 10);
    expect(page.count).toBe(1);
  });

  it("joins the account and category names for display", async () => {
    const page = await getLedger(churchId, { ...only, q: "IKEDC" }, 1, 10);
    expect(page.rows[0].accountName).toContain("Bank");
    expect(page.rows[0].categoryName).toContain("Electricity");
  });

  it("never shows another church's records", async () => {
    if (otherChurchId === churchId) return;
    const page = await getLedger(otherChurchId, only, 1, 50);
    const leaked = page.rows.filter((r) => txnIds.includes(r.id));
    expect(leaked).toHaveLength(0);
  });
});

describe("summary", () => {
  it("adds up the range and breaks it down by category", async () => {
    const s = await getFinanceSummary(churchId, "2026-03-01", "2026-04-30");
    expect(s.income).toBe(75000.5);
    expect(s.expense).toBe(20000.25);
    expect(s.net).toBe(55000.25);
    const names = s.byCategory.map((c) => c.name);
    expect(names.some((n) => n.includes("Hall hire"))).toBe(true);
    expect(names.some((n) => n.includes("Electricity"))).toBe(true);
  });

  it("sorts the breakdown biggest first", async () => {
    const s = await getFinanceSummary(churchId, "2026-03-01", "2026-04-30");
    const totals = s.byCategory.map((c) => c.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });
});

describe("export", () => {
  it("gives one row per record with readable labels", async () => {
    const rows = await getFinanceExportRows(churchId, {
      ...EMPTY_FINANCE_FILTERS,
      from: "2026-03-01",
      to: "2026-04-30",
      q: "IKEDC",
    });
    expect(rows).toHaveLength(1);
    const [date, type, amount, account, category, party] = rows[0];
    expect(date).toBe("2026-03-20");
    expect(type).toBe("Expense");
    expect(amount).toBe(18000);
    expect(String(account)).toContain("Bank");
    expect(String(category)).toContain("Electricity");
    expect(party).toBe("IKEDC");
  });
});
