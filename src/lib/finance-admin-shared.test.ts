import { describe, expect, it } from "vitest";
import {
  ENDING_SOON_DAYS,
  monthKey,
  monthlyValue,
  revenueByMonth,
  totalPayments,
  trialBucket,
  walletLiability,
  zeroReason,
  type PlanId,
} from "@/lib/finance-admin-shared";

const NOW = new Date(2026, 8, 13, 9, 0, 0); // 13 Sep 2026
const DAY = 86_400_000;

const PRICES: Record<PlanId, number | null> = {
  starter: 5000,
  growth: 12000,
  pro: 25000,
  enterprise: null, // priced per deal
};

describe("trialBucket", () => {
  it("says none when there is no trial", () => {
    expect(trialBucket(null, NOW)).toBe("none");
  });

  it("separates a trial worth chasing from one that is not urgent", () => {
    expect(trialBucket(new Date(NOW.getTime() + 30 * DAY), NOW)).toBe("active");
    expect(
      trialBucket(new Date(NOW.getTime() + (ENDING_SOON_DAYS - 1) * DAY), NOW),
    ).toBe("ending_soon");
  });

  it("counts a trial that ended as expired", () => {
    expect(trialBucket(new Date(NOW.getTime() - DAY), NOW)).toBe("expired");
  });

  it("treats the exact moment of expiry as expired, not as time left", () => {
    expect(trialBucket(new Date(NOW.getTime()), NOW)).toBe("expired");
  });

  it("does not crash on a nonsense date", () => {
    expect(trialBucket("not a date", NOW)).toBe("none");
  });
});

describe("monthlyValue", () => {
  it("is the list price for a paying church", () => {
    expect(monthlyValue({ plan: "pro", prices: PRICES, now: NOW })).toBe(25000);
  });

  it("is zero while they are still on trial", () => {
    // The single most flattering mistake a revenue dashboard can make.
    expect(
      monthlyValue({
        plan: "pro",
        prices: PRICES,
        trialEndsAt: new Date(NOW.getTime() + 20 * DAY),
        now: NOW,
      }),
    ).toBe(0);
  });

  it("counts them once the trial has run out", () => {
    expect(
      monthlyValue({
        plan: "pro",
        prices: PRICES,
        trialEndsAt: new Date(NOW.getTime() - DAY),
        now: NOW,
      }),
    ).toBe(25000);
  });

  it("is zero when the plan lapsed and nobody renewed", () => {
    expect(
      monthlyValue({
        plan: "growth",
        prices: PRICES,
        planRenewsAt: new Date(NOW.getTime() - DAY),
        now: NOW,
      }),
    ).toBe(0);
  });

  it("still counts a plan whose renewal is in the future", () => {
    expect(
      monthlyValue({
        plan: "growth",
        prices: PRICES,
        planRenewsAt: new Date(NOW.getTime() + 20 * DAY),
        now: NOW,
      }),
    ).toBe(12000);
  });

  it("applies a discount", () => {
    expect(
      monthlyValue({ plan: "pro", prices: PRICES, discountPct: 20, now: NOW }),
    ).toBe(20000);
  });

  it("treats a full discount as nothing, not as list price", () => {
    expect(
      monthlyValue({ plan: "pro", prices: PRICES, discountPct: 100, now: NOW }),
    ).toBe(0);
  });

  it("ignores a discount outside 0-100 rather than inverting the price", () => {
    expect(
      monthlyValue({ plan: "pro", prices: PRICES, discountPct: 150, now: NOW }),
    ).toBe(0);
    expect(
      monthlyValue({ plan: "pro", prices: PRICES, discountPct: -50, now: NOW }),
    ).toBe(25000);
  });

  it("counts nothing for enterprise, which has no list price", () => {
    // Guessing a number here would quietly invent revenue.
    expect(
      monthlyValue({ plan: "enterprise", prices: PRICES, now: NOW }),
    ).toBe(0);
  });
});

describe("totalPayments", () => {
  it("counts only what actually landed", () => {
    const out = totalPayments([
      { amount: 5000, status: "success" },
      { amount: 12000, status: "pending" },
      { amount: 25000, status: "failed" },
      { amount: "5000", status: "success" },
    ]);
    expect(out.collected).toBe(10000);
    expect(out.pending).toBe(12000);
    expect(out.failed).toBe(25000);
    expect(out.count).toBe(4);
  });

  it("copes with an empty list", () => {
    expect(totalPayments([]).collected).toBe(0);
  });

  it("treats an unreadable amount as zero rather than NaN", () => {
    expect(totalPayments([{ amount: "abc", status: "success" }]).collected).toBe(0);
  });
});

describe("revenueByMonth", () => {
  it("returns one bucket per month, oldest first, including empty ones", () => {
    const out = revenueByMonth([], 3, NOW);
    expect(out.map((r) => r.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(out.every((r) => r.total === 0)).toBe(true);
  });

  it("files a payment under the month it was paid, not when it was recorded", () => {
    // An offline transfer entered three weeks late belongs to the month the
    // money arrived, or every month-end total is wrong twice.
    const out = revenueByMonth(
      [
        {
          amount: 9000,
          status: "success",
          paidAt: new Date(2026, 7, 20),
          createdAt: new Date(2026, 8, 11),
        },
      ],
      3,
      NOW,
    );
    expect(out.find((r) => r.month === "2026-08")?.total).toBe(9000);
    expect(out.find((r) => r.month === "2026-09")?.total).toBe(0);
  });

  it("falls back to the created date when nothing was marked paid", () => {
    const out = revenueByMonth(
      [{ amount: 4000, status: "success", createdAt: new Date(2026, 8, 2) }],
      2,
      NOW,
    );
    expect(out.find((r) => r.month === "2026-09")?.total).toBe(4000);
  });

  it("ignores pending and failed payments", () => {
    const out = revenueByMonth(
      [
        { amount: 9000, status: "pending", paidAt: new Date(2026, 8, 2) },
        { amount: 9000, status: "failed", paidAt: new Date(2026, 8, 2) },
      ],
      2,
      NOW,
    );
    expect(out.find((r) => r.month === "2026-09")?.total).toBe(0);
  });

  it("drops anything older than the window instead of piling it on the first month", () => {
    const out = revenueByMonth(
      [{ amount: 9999, status: "success", paidAt: new Date(2024, 0, 5) }],
      3,
      NOW,
    );
    expect(out.reduce((n, r) => n + r.total, 0)).toBe(0);
  });
});

describe("walletLiability", () => {
  it("adds up what churches have not spent yet", () => {
    expect(walletLiability([1000, "2500", 0])).toBe(3500);
  });

  it("is zero for no wallets", () => {
    expect(walletLiability([])).toBe(0);
  });
});

describe("monthKey", () => {
  it("pads the month so keys sort correctly as text", () => {
    expect(monthKey(new Date(2026, 0, 9))).toBe("2026-01");
    expect(monthKey(new Date(2026, 11, 9))).toBe("2026-12");
  });
});

describe("zeroReason", () => {
  const base = { prices: PRICES, now: NOW } as const;

  it("separates a sale in progress from a sale to rescue", () => {
    expect(
      zeroReason({ ...base, plan: "pro", trialEndsAt: new Date(NOW.getTime() + 5 * DAY) }),
    ).toBe("trial");
    expect(
      zeroReason({ ...base, plan: "pro", planRenewsAt: new Date(NOW.getTime() - DAY) }),
    ).toBe("lapsed");
  });

  it("calls the free tier free rather than a problem", () => {
    expect(zeroReason({ ...base, plan: "starter", prices: { ...PRICES, starter: 0 } })).toBe("free");
  });

  it("says a custom-priced plan is custom, not missing", () => {
    expect(zeroReason({ ...base, plan: "enterprise" })).toBe("custom");
  });

  it("returns null when the church really is worth money", () => {
    expect(zeroReason({ ...base, plan: "pro" })).toBeNull();
  });

  it("reports the trial before the lapse when both are true", () => {
    // A church still inside its trial has not lapsed; it has not started.
    expect(
      zeroReason({
        ...base,
        plan: "pro",
        trialEndsAt: new Date(NOW.getTime() + 5 * DAY),
        planRenewsAt: new Date(NOW.getTime() - 30 * DAY),
      }),
    ).toBe("trial");
  });
});
