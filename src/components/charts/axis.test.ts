import { describe, expect, it } from "vitest";
import { CHART_MARGIN, compactTick, Y_AXIS_WIDTH } from "@/components/charts/axis";

describe("compactTick", () => {
  it("leaves small numbers exact — a church wants its real headcount", () => {
    expect(compactTick(0)).toBe("0");
    expect(compactTick(50)).toBe("50");
    expect(compactTick(255)).toBe("255");
    expect(compactTick(999)).toBe("999");
  });

  it("shortens thousands so the label cannot outgrow the axis", () => {
    expect(compactTick(1000)).toBe("1k");
    expect(compactTick(1200)).toBe("1.2k");
    expect(compactTick(1500)).toBe("1.5k");
  });

  it("drops the decimal once it stops adding anything", () => {
    expect(compactTick(12000)).toBe("12k");
    expect(compactTick(12500)).toBe("13k");
    expect(compactTick(250000)).toBe("250k");
  });

  it("handles millions, for a denomination-wide total", () => {
    expect(compactTick(1_000_000)).toBe("1.0m");
    expect(compactTick(2_500_000)).toBe("2.5m");
    expect(compactTick(25_000_000)).toBe("25m");
  });

  it("never returns a label long enough to be clipped", () => {
    // The whole bug was a label wider than the space reserved for it.
    for (const v of [0, 7, 99, 512, 1000, 9999, 123456, 9_999_999, 42_000_000]) {
      expect(compactTick(v).length, `${v} -> ${compactTick(v)}`).toBeLessThanOrEqual(5);
    }
  });

  it("survives nonsense instead of printing NaN on the axis", () => {
    expect(compactTick(Number.NaN)).toBe("");
    expect(compactTick(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("keeps negatives readable, should a net figure ever go below zero", () => {
    expect(compactTick(-250)).toBe("-250");
    expect(compactTick(-1500)).toBe("-1.5k");
  });
});

describe("chart geometry", () => {
  it("never pulls the plot area over the axis labels", () => {
    // A negative left margin is what clipped "1500" down to "500".
    expect(CHART_MARGIN.left).toBeGreaterThanOrEqual(0);
  });

  it("reserves room for the widest label the formatter can produce", () => {
    // 5 characters at 12px is comfortably under the reserved width.
    expect(Y_AXIS_WIDTH).toBeGreaterThanOrEqual(40);
  });
});
