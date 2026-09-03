import { describe, expect, it } from "vitest";
import {
  accountBalance,
  activeFilterCount,
  EMPTY_FINANCE_FILTERS,
  financeFilterQuery,
  isIsoDate,
  netOf,
  parseAmount,
  readFinanceFilters,
  roundMoney,
  shareOfTotal,
  signedAmount,
} from "@/lib/finance-shared";

describe("roundMoney", () => {
  it("settles float drift at the kobo", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney([333.4, 333.4, 333.4].reduce((a, b) => a + b, 0))).toBe(
      1000.2,
    );
  });

  it("leaves an exact amount alone", () => {
    expect(roundMoney(50000)).toBe(50000);
    expect(roundMoney(1234.56)).toBe(1234.56);
  });
});

describe("netOf", () => {
  it("is income less expense", () => {
    expect(netOf(500000, 320000)).toBe(180000);
  });

  it("goes negative when a church spends more than it receives", () => {
    // Worth stating plainly: an overspent month must read as overspent, not 0.
    expect(netOf(100000, 145000)).toBe(-45000);
  });

  it("does not drift on amounts with kobo", () => {
    expect(netOf(0.3, 0.1)).toBe(0.2);
  });
});

describe("accountBalance", () => {
  it("starts from the opening balance", () => {
    // A church joining mid-year must not have its existing money erased.
    expect(accountBalance(250000, 0, 0)).toBe(250000);
  });

  it("adds income and takes off expense", () => {
    expect(accountBalance(250000, 80000, 30000)).toBe(300000);
  });

  it("can go negative, because a real account can", () => {
    expect(accountBalance(0, 1000, 4000)).toBe(-3000);
  });
});

describe("signedAmount", () => {
  it("makes income positive and expense negative", () => {
    expect(signedAmount("income", 5000)).toBe(5000);
    expect(signedAmount("expense", 5000)).toBe(-5000);
  });
});

describe("shareOfTotal", () => {
  it("is a percentage of the total", () => {
    expect(shareOfTotal(25, 100)).toBe(25);
  });

  it("is zero rather than NaN when there is nothing to divide by", () => {
    expect(shareOfTotal(0, 0)).toBe(0);
  });

  it("never leaves the 0-100 range", () => {
    expect(shareOfTotal(150, 100)).toBe(100);
    expect(shareOfTotal(-5, 100)).toBe(0);
  });
});

describe("parseAmount", () => {
  it("accepts what a person actually types", () => {
    expect(parseAmount("1,500")).toBe(1500);
    expect(parseAmount(" 300 ")).toBe(300);
    expect(parseAmount("2,000.50")).toBe(2000.5);
    expect(parseAmount("NGN 750")).toBe(750);
  });

  it("rejects anything that is not a usable amount", () => {
    // Saving these as 0 or NaN would quietly corrupt a church's books.
    for (const bad of ["", "   ", "abc", "-", ".", "0", "-40"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });

  it("refuses an amount too large for the column", () => {
    // numeric(14,2) holds twelve digits before the point; more would throw at
    // the database instead of telling the person their figure is wrong.
    expect(parseAmount("999999999999")).toBe(999999999999); // twelve, fits
    expect(parseAmount("1000000000000")).toBeNull(); // thirteen, does not
  });
});

describe("isIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(isIsoDate("2026-09-02")).toBe(true);
  });

  it("rejects a malformed or impossible one", () => {
    for (const bad of ["", "2026-13-01", "2026-02-30", "02/09/2026", "2026-9-2"]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("readFinanceFilters", () => {
  it("reads what is there and ignores what is not", () => {
    const params = new URLSearchParams("q=rent&kind=expense&from=2026-01-01");
    const f = readFinanceFilters((k) => params.get(k));
    expect(f.q).toBe("rent");
    expect(f.kind).toBe("expense");
    expect(f.from).toBe("2026-01-01");
    expect(f.accountId).toBe("");
  });

  it("drops a kind that is not one of ours", () => {
    const params = new URLSearchParams("kind=whatever");
    expect(readFinanceFilters((k) => params.get(k)).kind).toBe("");
  });

  it("caps a very long search so it cannot bloat the query", () => {
    const params = new URLSearchParams(`q=${"x".repeat(500)}`);
    expect(readFinanceFilters((k) => params.get(k)).q).toHaveLength(120);
  });
});

describe("financeFilterQuery", () => {
  it("leaves empty filters out entirely", () => {
    expect(financeFilterQuery(EMPTY_FINANCE_FILTERS)).toBe("");
  });

  it("keeps page one out of the URL", () => {
    expect(financeFilterQuery({ kind: "income" }, 1)).toBe("kind=income");
    expect(financeFilterQuery({ kind: "income" }, 3)).toBe("kind=income&page=3");
  });

  it("round-trips through readFinanceFilters", () => {
    const original = {
      ...EMPTY_FINANCE_FILTERS,
      q: "generator diesel",
      kind: "expense",
      from: "2026-01-01",
      to: "2026-03-31",
    };
    const params = new URLSearchParams(financeFilterQuery(original));
    expect(readFinanceFilters((k) => params.get(k))).toEqual(original);
  });
});

describe("activeFilterCount", () => {
  it("does not count the search box, which has its own chip", () => {
    expect(activeFilterCount({ ...EMPTY_FINANCE_FILTERS, q: "rent" })).toBe(0);
  });

  it("counts a date range once, not twice", () => {
    expect(
      activeFilterCount({
        ...EMPTY_FINANCE_FILTERS,
        from: "2026-01-01",
        to: "2026-03-31",
      }),
    ).toBe(1);
  });

  it("adds up the rest", () => {
    expect(
      activeFilterCount({
        ...EMPTY_FINANCE_FILTERS,
        kind: "expense",
        accountId: "a",
        categoryId: "c",
        method: "cash",
        from: "2026-01-01",
      }),
    ).toBe(5);
  });
});
