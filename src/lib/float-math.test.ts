import { describe, expect, it } from "vitest";
import {
  coverageRatio,
  dailyBurnFromSnapshots,
  deriveUnitCost,
  marginFor,
  runwayDays,
  smsLiabilityPages,
} from "@/lib/float-math";

describe("deriveUnitCost", () => {
  it("divides observed drawdown by pages sent", () => {
    expect(deriveUnitCost({ drawdown: 350, pages: 100 })).toBe(3.5);
  });

  it("returns null on zero pages rather than dividing by zero", () => {
    expect(deriveUnitCost({ drawdown: 350, pages: 0 })).toBeNull();
  });

  it("returns null on a negative drawdown, which is a top-up not spend", () => {
    expect(deriveUnitCost({ drawdown: -500, pages: 100 })).toBeNull();
  });

  it("returns null on zero drawdown", () => {
    expect(deriveUnitCost({ drawdown: 0, pages: 100 })).toBeNull();
  });
});

describe("runwayDays", () => {
  it("divides balance by daily burn", () => {
    expect(runwayDays({ balance: 10_000, dailyBurn: 500 })).toBe(20);
  });

  it("returns null when burn is zero, since infinite runway is not a number", () => {
    expect(runwayDays({ balance: 10_000, dailyBurn: 0 })).toBeNull();
  });

  it("treats an empty wallet as zero days, not unknown", () => {
    expect(runwayDays({ balance: 0, dailyBurn: 500 })).toBe(0);
  });
});

describe("coverageRatio", () => {
  it("is exactly 1 when the balance just covers the liability", () => {
    expect(coverageRatio({ balance: 350, liabilityPages: 100, unitCost: 3.5 })).toBe(1);
  });

  it("drops below 1 when SMS has been sold that cannot be delivered", () => {
    expect(coverageRatio({ balance: 175, liabilityPages: 100, unitCost: 3.5 })).toBe(0.5);
  });

  it("returns null when the unit cost is unknown", () => {
    expect(coverageRatio({ balance: 350, liabilityPages: 100, unitCost: 0 })).toBeNull();
  });

  it("reports infinite coverage when nothing is owed", () => {
    expect(coverageRatio({ balance: 350, liabilityPages: 0, unitCost: 3.5 })).toBe(
      Infinity,
    );
  });
});

describe("smsLiabilityPages", () => {
  const now = new Date("2026-08-08T00:00:00Z");
  const soon = new Date("2026-08-20T00:00:00Z");
  const later = new Date("2026-12-01T00:00:00Z");

  it("subtracts storage committed within the next 31 days", () => {
    expect(
      smsLiabilityPages({
        walletBalance: 1000,
        storageMonthlyCost: 200,
        storageRenewsAt: soon,
        smsPrice: 4,
        now,
      }),
    ).toBe(200);
  });

  it("ignores storage renewing beyond 31 days", () => {
    expect(
      smsLiabilityPages({
        walletBalance: 1000,
        storageMonthlyCost: 200,
        storageRenewsAt: later,
        smsPrice: 4,
        now,
      }),
    ).toBe(250);
  });

  it("never goes negative when storage exceeds the wallet", () => {
    expect(
      smsLiabilityPages({
        walletBalance: 100,
        storageMonthlyCost: 500,
        storageRenewsAt: soon,
        smsPrice: 4,
        now,
      }),
    ).toBe(0);
  });

  it("returns 0 when the SMS price is zero rather than dividing by zero", () => {
    expect(
      smsLiabilityPages({
        walletBalance: 1000,
        storageMonthlyCost: 0,
        storageRenewsAt: null,
        smsPrice: 0,
        now,
      }),
    ).toBe(0);
  });

  it("counts an overdue storage renewal as still committed", () => {
    expect(
      smsLiabilityPages({
        walletBalance: 1000,
        storageMonthlyCost: 200,
        storageRenewsAt: new Date("2026-07-01T00:00:00Z"),
        smsPrice: 4,
        now,
      }),
    ).toBe(200);
  });
});

describe("marginFor", () => {
  it("is pages times the spread between sell price and cost", () => {
    expect(marginFor({ pages: 100, smsPrice: 4, unitCost: 3.5 })).toBe(50);
  });

  it("goes negative when selling below cost", () => {
    expect(marginFor({ pages: 100, smsPrice: 3, unitCost: 3.5 })).toBe(-50);
  });
});

describe("dailyBurnFromSnapshots", () => {
  const on = (day: number) => new Date(2026, 7, day);

  it("sums only the decreases and spreads them over the window", () => {
    const snapshots = [
      { balance: 10_000, fetchedAt: on(1) },
      { balance: 9_000, fetchedAt: on(2) },
      { balance: 12_000, fetchedAt: on(3) }, // a top-up, not spend
      { balance: 11_000, fetchedAt: on(4) },
    ];
    expect(dailyBurnFromSnapshots(snapshots, 4)).toBe(500);
  });

  it("returns null with fewer than two usable points", () => {
    expect(dailyBurnFromSnapshots([{ balance: 10_000, fetchedAt: on(1) }], 7)).toBeNull();
  });

  it("skips failed snapshots that carry no balance", () => {
    expect(
      dailyBurnFromSnapshots(
        [
          { balance: null, fetchedAt: on(1) },
          { balance: null, fetchedAt: on(2) },
        ],
        7,
      ),
    ).toBeNull();
  });

  it("sorts out-of-order snapshots before differencing", () => {
    const snapshots = [
      { balance: 9_000, fetchedAt: on(2) },
      { balance: 10_000, fetchedAt: on(1) },
    ];
    expect(dailyBurnFromSnapshots(snapshots, 2)).toBe(500);
  });
});
