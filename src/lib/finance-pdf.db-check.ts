/**
 * Rendering checks for the finance PDF. Run with `pnpm test:db`.
 *
 * These do not touch the database, but they live here because rendering a PDF
 * is slow and pulls in the whole @react-pdf stack — not something to put in
 * the fast unit suite.
 *
 * The point is that the document actually renders. A PDF that throws only
 * surfaces when a treasurer clicks download.
 */
import { describe, expect, it } from "vitest";
import { renderFinancePdf } from "@/lib/finance-pdf";
import type { ChurchBrand } from "@/lib/pdf-brand";
import type {
  FinanceAccountRow,
  FinanceSummary,
  FinanceTransactionRow,
} from "@/lib/finance-data";

const brand = (over: Partial<ChurchBrand> = {}): ChurchBrand => ({
  name: "Grace Chapel International",
  logo: null,
  primary: "#0284c7",
  from: "#0ea5e9",
  to: "#2563eb",
  contact: "12 Church Road, Ikeja, Lagos  ·  0801 234 5678  ·  hi@grace.org",
  ...over,
});

const summary: FinanceSummary = {
  income: 1250000,
  expense: 480000.5,
  net: 769999.5,
  cashOnHand: 2100000,
  byCategory: [
    { id: "c1", name: "Offering", kind: "income", total: 900000 },
    { id: "c2", name: "Electricity", kind: "expense", total: 320000 },
    { id: null, name: "Uncategorised", kind: "expense", total: 160000.5 },
  ],
};

const accounts: FinanceAccountRow[] = [
  {
    id: "a1",
    name: "Main current account",
    type: "bank",
    institution: "First Bank",
    accountNumber: "0123456789",
    openingBalance: 500000,
    isActive: true,
    note: null,
    givingCategoryId: null,
    givingCategoryName: null,
    balance: 1600000,
    income: 1250000,
    expense: 480000.5,
    transferredIn: 0,
    transferredOut: 0,
    transactionCount: 40,
  },
  {
    id: "a2",
    name: "Building Project",
    type: "other",
    institution: null,
    accountNumber: null,
    openingBalance: 0,
    isActive: true,
    note: null,
    givingCategoryId: "cat-1",
    givingCategoryName: "Building Project",
    balance: 500000,
    income: 700000,
    expense: 0,
    transferredIn: 0,
    transferredOut: 200000,
    transactionCount: 12,
  },
];

function rows(n: number): FinanceTransactionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    kind: i % 3 === 0 ? ("income" as const) : ("expense" as const),
    amount: 1000 + i,
    date: "2026-03-15",
    accountId: "a1",
    accountName: "Main current account",
    categoryId: "c1",
    categoryName: "Offering",
    party: `Payee ${i}`,
    reference: `INV-${i}`,
    method: "transfer" as const,
    note: null,
    recordedByName: "Pastor Ada",
  }));
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";

describe("the finance statement renders", () => {
  it("produces a real PDF", async () => {
    const pdf = await renderFinancePdf({
      brand: brand(),
      currency: "NGN",
      summary,
      accounts,
      rows: rows(30),
      totalRows: 30,
      rangeLabel: "2026-01-01 to 2026-03-31",
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders with a church logo", async () => {
    // A 1x1 PNG — enough to prove the image path is exercised rather than the
    // fallback mark.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const pdf = await renderFinancePdf({
      brand: brand({ logo: png }),
      currency: "NGN",
      summary,
      accounts,
      rows: rows(5),
      totalRows: 5,
      rangeLabel: "All time",
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("survives a church with nothing filled in", async () => {
    // No logo, no contact details, no accounts, no entries. This is a church
    // on its first day, and the download must still work.
    const pdf = await renderFinancePdf({
      brand: brand({ logo: null, contact: null }),
      currency: "NGN",
      summary: {
        income: 0,
        expense: 0,
        net: 0,
        cashOnHand: 0,
        byCategory: [],
      },
      accounts: [],
      rows: [],
      totalRows: 0,
      rangeLabel: "All time",
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("caps a very long ledger rather than rendering for ever", async () => {
    const pdf = await renderFinancePdf({
      brand: brand(),
      currency: "NGN",
      summary,
      accounts,
      rows: rows(1500),
      totalRows: 4000,
      rangeLabel: "All time",
    });
    expect(isPdf(pdf)).toBe(true);
  }, 60000);

  it("handles a negative net without breaking the layout", async () => {
    const pdf = await renderFinancePdf({
      brand: brand(),
      currency: "NGN",
      summary: { ...summary, income: 100000, expense: 145000, net: -45000 },
      accounts,
      rows: rows(3),
      totalRows: 3,
      rangeLabel: "Last month",
    });
    expect(isPdf(pdf)).toBe(true);
  });
});
