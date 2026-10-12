import { describe, expect, it } from "vitest";
import { remainingShare, storageSwitchQuote } from "@/lib/storage-switch";

/**
 * Switching storage bundles mid-month. The bug: every switch charged a whole
 * new month and kept nothing of the old one, so a mis-tap cost a month.
 */

const NOW = new Date("2026-10-12T12:00:00Z");
const in27Days = new Date("2026-11-08T12:00:00Z");

describe("storageSwitchQuote", () => {
  it("charges a plain first month when no add-on is running", () => {
    const q = storageSwitchQuote({ currentGb: 0, currentMonthlyCost: 0, renewsAt: null }, { gb: 5, price: 2000 }, NOW);
    expect(q.kind).toBe("new");
    if (q.kind === "new") {
      expect(q.charge).toBe(2000);
      expect(q.renewsAt.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    }
  });

  it("treats a lapsed add-on as none", () => {
    const q = storageSwitchQuote(
      { currentGb: 5, currentMonthlyCost: 2000, renewsAt: new Date("2026-10-01T00:00:00Z") },
      { gb: 5, price: 2000 },
      NOW,
    );
    expect(q.kind).toBe("new");
  });

  it("refuses to charge again for the bundle already running", () => {
    const q = storageSwitchQuote(
      { currentGb: 5, currentMonthlyCost: 2000, renewsAt: in27Days },
      { gb: 5, price: 2000 },
      NOW,
    );
    expect(q.kind).toBe("same");
  });

  it("charges only the difference for the days left on an upgrade, and keeps the date", () => {
    const q = storageSwitchQuote(
      { currentGb: 5, currentMonthlyCost: 2000, renewsAt: in27Days },
      { gb: 20, price: 6000 },
      NOW,
    );
    expect(q.kind).toBe("upgrade");
    if (q.kind === "upgrade") {
      const share = remainingShare(in27Days, NOW);
      expect(q.charge).toBe(Math.ceil(4000 * share));
      expect(q.charge).toBeLessThan(4000);
      expect(q.renewsAt).toEqual(in27Days);
    }
  });

  it("gives back the unused difference on a downgrade instead of charging a month", () => {
    const q = storageSwitchQuote(
      { currentGb: 20, currentMonthlyCost: 6000, renewsAt: in27Days },
      { gb: 5, price: 2000 },
      NOW,
    );
    expect(q.kind).toBe("downgrade");
    if (q.kind === "downgrade") {
      expect(q.refund).toBe(Math.floor(4000 * remainingShare(in27Days, NOW)));
      expect(q.renewsAt).toEqual(in27Days);
    }
  });

  it("never makes money out of nothing: up and back down nets to at most ₦1", () => {
    const up = storageSwitchQuote(
      { currentGb: 5, currentMonthlyCost: 2000, renewsAt: in27Days },
      { gb: 20, price: 6000 },
      NOW,
    );
    const down = storageSwitchQuote(
      { currentGb: 20, currentMonthlyCost: 6000, renewsAt: in27Days },
      { gb: 5, price: 2000 },
      NOW,
    );
    if (up.kind !== "upgrade" || down.kind !== "downgrade") throw new Error("kinds");
    const net = up.charge - down.refund;
    expect(net).toBeGreaterThanOrEqual(0);
    expect(net).toBeLessThanOrEqual(1);
  });
});

describe("remainingShare", () => {
  it("is 1 at the start of a month and 0 at its end", () => {
    const renews = new Date("2026-11-12T12:00:00Z");
    expect(remainingShare(renews, NOW)).toBe(1);
    expect(remainingShare(renews, renews)).toBe(0);
  });
});
