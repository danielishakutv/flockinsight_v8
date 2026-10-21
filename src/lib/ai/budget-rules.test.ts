import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, canReserve, isStale, monthKey, usdToNano } from "./budget-rules";

describe("canReserve", () => {
  it("allows a reservation that lands exactly on the ceiling, and refuses one nano over", () => {
    expect(canReserve({ spent: 60, reserved: 30 }, 100, 10)).toBe(true);
    expect(canReserve({ spent: 60, reserved: 30 }, 100, 11)).toBe(false);
  });

  it("counts reservations still in flight against the ceiling", () => {
    expect(canReserve({ spent: 0, reserved: 100 }, 100, 1)).toBe(false);
  });
});

describe("monthKey", () => {
  it("is the UTC month, even where the local clock has already moved on", () => {
    expect(monthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-31T23:30:00-02:00"))).toBe("2027-01");
  });
});

describe("isStale", () => {
  it("turns at 15 minutes, not before", () => {
    const created = new Date("2026-10-21T10:00:00Z");
    expect(isStale(created, new Date(created.getTime() + STALE_AFTER_MS))).toBe(false);
    expect(isStale(created, new Date(created.getTime() + STALE_AFTER_MS + 1))).toBe(true);
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
  });
});

describe("usdToNano", () => {
  it("converts the $20 ceiling to 2e10 nano-dollars", () => {
    expect(usdToNano(20)).toBe(20_000_000_000);
    expect(usdToNano(0.5)).toBe(500_000_000);
  });
});
