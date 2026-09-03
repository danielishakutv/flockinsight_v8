/**
 * Finance module — the parts with no database in them.
 *
 * Safe to import from a client component, and testable on its own. The money
 * arithmetic lives here rather than being repeated in each page, so the ledger,
 * the summary cards and the CSV can never disagree about what a balance is.
 */

export type FinanceKind = "income" | "expense";
export type FinanceAccountType = "bank" | "cash" | "mobile_money" | "other";
export type FinanceMethod =
  | "cash"
  | "transfer"
  | "card"
  | "cheque"
  | "online"
  | "other";

export const FINANCE_KINDS: FinanceKind[] = ["income", "expense"];

export const KIND_LABEL: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expense",
};

export const ACCOUNT_TYPES: FinanceAccountType[] = [
  "bank",
  "cash",
  "mobile_money",
  "other",
];

export const ACCOUNT_TYPE_LABEL: Record<FinanceAccountType, string> = {
  bank: "Bank account",
  cash: "Cash box",
  mobile_money: "Mobile money",
  other: "Other",
};

export const FINANCE_METHODS: FinanceMethod[] = [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
];

export const METHOD_LABEL: Record<FinanceMethod, string> = {
  cash: "Cash",
  transfer: "Transfer",
  card: "Card",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

/**
 * Round to the currency's smallest unit.
 *
 * Amounts are exact numeric(14,2) in Postgres but arrive as JavaScript
 * numbers, so a total added up in JavaScript can land a hair off — the same
 * drift that once kept fully-paid pledges on the outstanding report. Every
 * figure this module hands out goes through here.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** What is left after expenses. Negative means more went out than came in. */
export function netOf(income: number, expense: number): number {
  return roundMoney(income - expense);
}

/** What an account holds: what it started with, plus income, less expense. */
export function accountBalance(
  openingBalance: number,
  income: number,
  expense: number,
): number {
  return roundMoney(openingBalance + income - expense);
}

/**
 * A transaction's effect on a balance: income adds, expense subtracts.
 * Amounts are always stored positive, so the sign lives here and only here.
 */
export function signedAmount(kind: FinanceKind, amount: number): number {
  return kind === "income" ? roundMoney(amount) : roundMoney(-amount);
}

/**
 * Share of a total, for the category breakdown bars. Guards the empty case so
 * a church with no records sees zeroes rather than NaN.
 */
export function shareOfTotal(value: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

/* ============================================================
 * Starting categories
 *
 * A church should be able to record its first expense without first building a
 * chart of accounts, so these are offered on the empty state. They are only a
 * starting point — every one can be renamed, retired or ignored.
 * ========================================================== */

export const DEFAULT_INCOME_CATEGORIES: string[] = [
  "Offering",
  "Tithe",
  "Donation",
  "Building fund",
  "Hall hire",
  "Sale of materials",
  "Other income",
];

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  "Staff salaries",
  "Pastoral welfare",
  "Rent",
  "Electricity",
  "Water",
  "Internet & airtime",
  "Transport & fuel",
  "Maintenance & repairs",
  "Equipment",
  "Refreshments",
  "Outreach & missions",
  "Benevolence",
  "Bank charges",
  "Other expense",
];

export function defaultCategoriesFor(kind: FinanceKind): string[] {
  return kind === "income"
    ? DEFAULT_INCOME_CATEGORIES
    : DEFAULT_EXPENSE_CATEGORIES;
}

/* ============================================================
 * Ledger filters — shared so the page, the pager and the CSV agree
 * ========================================================== */

export type FinanceFilterState = {
  q: string;
  kind: string;
  accountId: string;
  categoryId: string;
  method: string;
  from: string;
  to: string;
};

export const EMPTY_FINANCE_FILTERS: FinanceFilterState = {
  q: "",
  kind: "",
  accountId: "",
  categoryId: "",
  method: "",
  from: "",
  to: "",
};

/** Marker for "recorded without one", distinct from "any". */
export const FINANCE_FILTER_NONE = "none";

/** Read filters out of a URL's search params. */
export function readFinanceFilters(
  get: (key: string) => string | null | undefined,
): FinanceFilterState {
  const s = (key: string) => (get(key) ?? "").toString().trim();
  const kind = s("kind");
  return {
    q: s("q").slice(0, 120),
    kind: kind === "income" || kind === "expense" ? kind : "",
    accountId: s("account"),
    categoryId: s("cat"),
    method: s("method"),
    from: s("from"),
    to: s("to"),
  };
}

/** Turn filters back into a query string. Empty values are left out entirely. */
export function financeFilterQuery(
  f: Partial<FinanceFilterState>,
  page = 1,
): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.kind) sp.set("kind", f.kind);
  if (f.accountId) sp.set("account", f.accountId);
  if (f.categoryId) sp.set("cat", f.categoryId);
  if (f.method) sp.set("method", f.method);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (page > 1) sp.set("page", String(page));
  return sp.toString();
}

/** How many filters are narrowing the ledger, for the "Filters (2)" badge. */
export function activeFilterCount(f: FinanceFilterState): number {
  return (
    (f.kind ? 1 : 0) +
    (f.accountId ? 1 : 0) +
    (f.categoryId ? 1 : 0) +
    (f.method ? 1 : 0) +
    (f.from || f.to ? 1 : 0)
  );
}

/* ============================================================
 * Dates
 * ========================================================== */

function iso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Quick ranges, evaluated against the church's own "today". */
export function financePresets(
  today: string,
): { label: string; from: string; to: string }[] {
  const now = new Date(`${today}T00:00:00`);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const last30 = new Date(now);
  last30.setDate(last30.getDate() - 29);

  return [
    { label: "This month", from: iso(thisMonth), to: today },
    { label: "Last month", from: iso(lastMonth), to: iso(lastMonthEnd) },
    { label: "Last 30 days", from: iso(last30), to: today },
    { label: "This year", from: `${now.getFullYear()}-01-01`, to: today },
    {
      label: "Last year",
      from: `${now.getFullYear() - 1}-01-01`,
      to: `${now.getFullYear() - 1}-12-31`,
    },
  ];
}

/** Validate a yyyy-mm-dd string, so a hand-edited URL cannot reach the query. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && iso(d) === value;
}

/**
 * Parse an amount the way a person types one: "1,500", "2,000.50", " 300 ".
 * Returns null when it is not a usable positive amount, so the caller can say
 * so rather than saving a zero or a NaN.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Guard the column: numeric(14,2) holds twelve digits before the point.
  if (n >= 1e12) return null;
  return roundMoney(n);
}
