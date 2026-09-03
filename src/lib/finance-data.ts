import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  financeAccount,
  financeCategory,
  financeTransaction,
  user,
} from "@/db/schema";
import {
  accountBalance,
  isIsoDate,
  netOf,
  roundMoney,
  type FinanceFilterState,
  type FinanceKind,
  type FinanceMethod,
  type FinanceAccountType,
  FINANCE_FILTER_NONE,
} from "@/lib/finance-shared";

/**
 * Reads for the finance module.
 *
 * Every query is scoped by churchId — one church must never see another's
 * books. Sums are done in Postgres against numeric columns, so the arithmetic
 * is exact; the JavaScript side only rounds for display.
 */

export const FINANCE_PAGE_SIZE = 25;

export type FinanceAccountRow = {
  id: string;
  name: string;
  type: FinanceAccountType;
  institution: string | null;
  accountNumber: string | null;
  openingBalance: number;
  isActive: boolean;
  note: string | null;
  /** Opening balance plus everything recorded against it. */
  balance: number;
  income: number;
  expense: number;
  transactionCount: number;
};

export type FinanceCategoryRow = {
  id: string;
  name: string;
  kind: FinanceKind;
  isActive: boolean;
  transactionCount: number;
  total: number;
};

export type FinanceTransactionRow = {
  id: string;
  kind: FinanceKind;
  amount: number;
  date: string;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  party: string | null;
  reference: string | null;
  method: FinanceMethod | null;
  note: string | null;
  recordedByName: string | null;
};

/* ============================================================
 * Accounts
 * ========================================================== */

/**
 * Every account with its balance worked out from its transactions.
 *
 * The totals come from one grouped pass rather than a query per account, so a
 * church with twenty accounts still costs two round trips.
 */
export async function listAccounts(
  churchId: string,
): Promise<FinanceAccountRow[]> {
  const [accounts, totals] = await Promise.all([
    db
      .select()
      .from(financeAccount)
      .where(eq(financeAccount.churchId, churchId))
      .orderBy(desc(financeAccount.isActive), asc(financeAccount.name)),
    db
      .select({
        accountId: financeTransaction.accountId,
        kind: financeTransaction.kind,
        total: sql<number>`coalesce(sum(${financeTransaction.amount}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(financeTransaction)
      .where(eq(financeTransaction.churchId, churchId))
      .groupBy(financeTransaction.accountId, financeTransaction.kind),
  ]);

  const byAccount = new Map<
    string,
    { income: number; expense: number; count: number }
  >();
  for (const t of totals) {
    if (!t.accountId) continue;
    const entry = byAccount.get(t.accountId) ?? {
      income: 0,
      expense: 0,
      count: 0,
    };
    entry[t.kind] += Number(t.total ?? 0);
    entry.count += Number(t.count ?? 0);
    byAccount.set(t.accountId, entry);
  }

  return accounts.map((a) => {
    const t = byAccount.get(a.id) ?? { income: 0, expense: 0, count: 0 };
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      accountNumber: a.accountNumber,
      openingBalance: Number(a.openingBalance ?? 0),
      isActive: a.isActive,
      note: a.note,
      income: roundMoney(t.income),
      expense: roundMoney(t.expense),
      balance: accountBalance(Number(a.openingBalance ?? 0), t.income, t.expense),
      transactionCount: t.count,
    };
  });
}

/** Just the active accounts, for the pickers. */
export async function activeAccountOptions(
  churchId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: financeAccount.id, name: financeAccount.name })
    .from(financeAccount)
    .where(
      and(
        eq(financeAccount.churchId, churchId),
        eq(financeAccount.isActive, true),
      ),
    )
    .orderBy(asc(financeAccount.name));
}

/* ============================================================
 * Categories
 * ========================================================== */

export async function listCategories(
  churchId: string,
): Promise<FinanceCategoryRow[]> {
  const [categories, totals] = await Promise.all([
    db
      .select()
      .from(financeCategory)
      .where(eq(financeCategory.churchId, churchId))
      .orderBy(
        asc(financeCategory.kind),
        desc(financeCategory.isActive),
        asc(financeCategory.name),
      ),
    db
      .select({
        categoryId: financeTransaction.categoryId,
        total: sql<number>`coalesce(sum(${financeTransaction.amount}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(financeTransaction)
      .where(eq(financeTransaction.churchId, churchId))
      .groupBy(financeTransaction.categoryId),
  ]);

  const byCategory = new Map(
    totals
      .filter((t) => t.categoryId)
      .map((t) => [
        t.categoryId as string,
        { total: Number(t.total ?? 0), count: Number(t.count ?? 0) },
      ]),
  );

  return categories.map((c) => {
    const t = byCategory.get(c.id) ?? { total: 0, count: 0 };
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      isActive: c.isActive,
      total: roundMoney(t.total),
      transactionCount: t.count,
    };
  });
}

/** Active categories for the pickers, both kinds, so the form can switch. */
export async function activeCategoryOptions(
  churchId: string,
): Promise<{ id: string; name: string; kind: FinanceKind }[]> {
  return db
    .select({
      id: financeCategory.id,
      name: financeCategory.name,
      kind: financeCategory.kind,
    })
    .from(financeCategory)
    .where(
      and(
        eq(financeCategory.churchId, churchId),
        eq(financeCategory.isActive, true),
      ),
    )
    .orderBy(asc(financeCategory.name));
}

/* ============================================================
 * The ledger
 * ========================================================== */

/**
 * Turn the filter state into a WHERE clause.
 *
 * Every branch is a bound parameter through Drizzle, and the churchId term is
 * added first and unconditionally, so no filter combination can widen the
 * query beyond one church.
 */
function whereFor(churchId: string, f: FinanceFilterState): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    eq(financeTransaction.churchId, churchId),
  ];

  if (f.kind === "income" || f.kind === "expense") {
    parts.push(eq(financeTransaction.kind, f.kind));
  }
  if (f.accountId) {
    parts.push(
      f.accountId === FINANCE_FILTER_NONE
        ? sql`${financeTransaction.accountId} is null`
        : eq(financeTransaction.accountId, f.accountId),
    );
  }
  if (f.categoryId) {
    parts.push(
      f.categoryId === FINANCE_FILTER_NONE
        ? sql`${financeTransaction.categoryId} is null`
        : eq(financeTransaction.categoryId, f.categoryId),
    );
  }
  if (f.method) {
    parts.push(eq(financeTransaction.method, f.method as FinanceMethod));
  }
  // A hand-edited URL must not reach the date comparison as a raw string.
  if (f.from && isIsoDate(f.from)) {
    parts.push(gte(financeTransaction.date, f.from));
  }
  if (f.to && isIsoDate(f.to)) {
    parts.push(lte(financeTransaction.date, f.to));
  }

  if (f.q) {
    const like = `%${f.q}%`;
    const asNumber = Number(f.q.replace(/[^\d.]/g, ""));
    const matches: (SQL | undefined)[] = [
      ilike(financeTransaction.party, like),
      ilike(financeTransaction.reference, like),
      ilike(financeTransaction.note, like),
    ];
    // Searching "5000" should find the 5,000 entry, not just text containing it.
    if (Number.isFinite(asNumber) && asNumber > 0) {
      matches.push(eq(financeTransaction.amount, asNumber));
    }
    parts.push(or(...matches));
  }

  return and(...parts);
}

export type FinanceLedgerPage = {
  rows: FinanceTransactionRow[];
  /** Count and totals across every match, not just this page. */
  count: number;
  income: number;
  expense: number;
  net: number;
};

export async function getLedger(
  churchId: string,
  filters: FinanceFilterState,
  page: number,
  pageSize = FINANCE_PAGE_SIZE,
): Promise<FinanceLedgerPage> {
  const where = whereFor(churchId, filters);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: financeTransaction.id,
        kind: financeTransaction.kind,
        amount: financeTransaction.amount,
        date: financeTransaction.date,
        accountId: financeTransaction.accountId,
        accountName: financeAccount.name,
        categoryId: financeTransaction.categoryId,
        categoryName: financeCategory.name,
        party: financeTransaction.party,
        reference: financeTransaction.reference,
        method: financeTransaction.method,
        note: financeTransaction.note,
        recordedByName: user.name,
      })
      .from(financeTransaction)
      .leftJoin(
        financeAccount,
        eq(financeAccount.id, financeTransaction.accountId),
      )
      .leftJoin(
        financeCategory,
        eq(financeCategory.id, financeTransaction.categoryId),
      )
      .leftJoin(user, eq(user.id, financeTransaction.recordedBy))
      .where(where)
      // createdAt breaks the tie so two entries on the same day keep a stable
      // order between pages instead of shuffling.
      .orderBy(desc(financeTransaction.date), desc(financeTransaction.createdAt))
      .limit(pageSize)
      .offset((safePage - 1) * pageSize),
    db
      .select({
        kind: financeTransaction.kind,
        total: sql<number>`coalesce(sum(${financeTransaction.amount}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(financeTransaction)
      .where(where)
      .groupBy(financeTransaction.kind),
  ]);

  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of totals) {
    const total = Number(t.total ?? 0);
    if (t.kind === "income") income += total;
    else expense += total;
    count += Number(t.count ?? 0);
  }

  return {
    rows: rows.map((r) => ({ ...r, amount: Number(r.amount ?? 0) })),
    count,
    income: roundMoney(income),
    expense: roundMoney(expense),
    net: netOf(income, expense),
  };
}

/* ============================================================
 * Summary
 * ========================================================== */

export type FinanceSummary = {
  income: number;
  expense: number;
  net: number;
  /** Sum of every account's balance, including opening balances. */
  cashOnHand: number;
  byCategory: {
    id: string | null;
    name: string;
    kind: FinanceKind;
    total: number;
  }[];
};

/**
 * Headline figures for the page above the ledger.
 *
 * The income/expense pair honours the current date range; cash on hand
 * deliberately does not, because what an account holds is a fact about now,
 * not about the window someone happens to be looking at.
 */
export async function getFinanceSummary(
  churchId: string,
  from: string,
  to: string,
): Promise<FinanceSummary> {
  const range: (SQL | undefined)[] = [eq(financeTransaction.churchId, churchId)];
  if (from && isIsoDate(from)) range.push(gte(financeTransaction.date, from));
  if (to && isIsoDate(to)) range.push(lte(financeTransaction.date, to));
  const where = and(...range);

  const [totals, byCategory, accounts] = await Promise.all([
    db
      .select({
        kind: financeTransaction.kind,
        total: sql<number>`coalesce(sum(${financeTransaction.amount}), 0)`,
      })
      .from(financeTransaction)
      .where(where)
      .groupBy(financeTransaction.kind),
    db
      .select({
        id: financeTransaction.categoryId,
        name: financeCategory.name,
        kind: financeTransaction.kind,
        total: sql<number>`coalesce(sum(${financeTransaction.amount}), 0)`,
      })
      .from(financeTransaction)
      .leftJoin(
        financeCategory,
        eq(financeCategory.id, financeTransaction.categoryId),
      )
      .where(where)
      .groupBy(
        financeTransaction.categoryId,
        financeCategory.name,
        financeTransaction.kind,
      ),
    listAccounts(churchId),
  ]);

  let income = 0;
  let expense = 0;
  for (const t of totals) {
    if (t.kind === "income") income = Number(t.total ?? 0);
    else expense = Number(t.total ?? 0);
  }

  return {
    income: roundMoney(income),
    expense: roundMoney(expense),
    net: netOf(income, expense),
    cashOnHand: roundMoney(
      accounts
        .filter((a) => a.isActive)
        .reduce((sum, a) => sum + a.balance, 0),
    ),
    byCategory: byCategory
      .map((c) => ({
        id: c.id,
        name: c.name ?? "Uncategorised",
        kind: c.kind,
        total: roundMoney(Number(c.total ?? 0)),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/* ============================================================
 * Export
 * ========================================================== */

export const FINANCE_CSV_HEADERS = [
  "Date",
  "Type",
  "Amount",
  "Account",
  "Category",
  "Party",
  "Method",
  "Reference",
  "Note",
  "Recorded by",
];

/** Every matching row for the CSV, in the same order the ledger shows them. */
export async function getFinanceExportRows(
  churchId: string,
  filters: FinanceFilterState,
): Promise<(string | number | null)[][]> {
  const rows = await db
    .select({
      date: financeTransaction.date,
      kind: financeTransaction.kind,
      amount: financeTransaction.amount,
      accountName: financeAccount.name,
      categoryName: financeCategory.name,
      party: financeTransaction.party,
      method: financeTransaction.method,
      reference: financeTransaction.reference,
      note: financeTransaction.note,
      recordedByName: user.name,
    })
    .from(financeTransaction)
    .leftJoin(
      financeAccount,
      eq(financeAccount.id, financeTransaction.accountId),
    )
    .leftJoin(
      financeCategory,
      eq(financeCategory.id, financeTransaction.categoryId),
    )
    .leftJoin(user, eq(user.id, financeTransaction.recordedBy))
    .where(whereFor(churchId, filters))
    .orderBy(desc(financeTransaction.date), desc(financeTransaction.createdAt));

  return rows.map((r) => [
    r.date,
    r.kind === "income" ? "Income" : "Expense",
    Number(r.amount ?? 0),
    r.accountName,
    r.categoryName,
    r.party,
    r.method,
    r.reference,
    r.note,
    r.recordedByName,
  ]);
}
