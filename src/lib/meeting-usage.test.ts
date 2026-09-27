import { describe, expect, it } from "vitest";
import { costFor, monthStart, projectMonth, USD_PER_GB } from "@/lib/meeting-usage";

/**
 * The money arithmetic. Every one of these numbers ends up on an invoice or in
 * a decision about pricing, so the edges are worth pinning — particularly the
 * free tier, which is the difference between "this feature costs nothing" and
 * "this feature costs nothing until it suddenly does".
 */

describe("costFor", () => {
  it("is free inside the allowance", () => {
    expect(costFor(400, 1000)).toBe(0);
  });

  it("charges only what is past the allowance, not the whole amount", () => {
    // The mistake worth guarding: billing all 1,200 GB the moment the tier is
    // exceeded would overstate the cost twenty-fold at the boundary.
    expect(costFor(1200, 1000)).toBeCloseTo(200 * USD_PER_GB, 6);
  });

  it("charges from the first gigabyte when nothing is left", () => {
    expect(costFor(10, 0)).toBeCloseTo(10 * USD_PER_GB, 6);
  });

  it("never goes negative on a nonsense allowance", () => {
    expect(costFor(10, -5)).toBeCloseTo(10 * USD_PER_GB, 6);
    expect(costFor(0, 1000)).toBe(0);
  });
});

describe("projectMonth", () => {
  it("doubles a half-finished month", () => {
    // 15 days into a 30-day month: whatever has been used so far, again.
    const at = new Date(Date.UTC(2026, 3, 16));
    expect(projectMonth(500, at).gb).toBeCloseTo(1000, 0);
  });

  it("does not divide by zero on the first moment of a month", () => {
    // The obvious crash: days elapsed is 0 at midnight on the 1st.
    const at = monthStart(new Date(Date.UTC(2026, 3, 1)));
    const out = projectMonth(10, at);
    expect(Number.isFinite(out.gb)).toBe(true);
  });

  it("projects a cost of zero while the projection stays inside the tier", () => {
    const at = new Date(Date.UTC(2026, 3, 16));
    expect(projectMonth(100, at).costUsd).toBe(0);
  });

  it("projects real money once the trend passes the tier", () => {
    const at = new Date(Date.UTC(2026, 3, 16));
    // 800 GB by the 16th trends to ~1,600 — 600 of them billable.
    expect(projectMonth(800, at).costUsd).toBeGreaterThan(25);
  });
});

describe("monthStart", () => {
  it("is the first of the month in UTC", () => {
    const d = monthStart(new Date(Date.UTC(2026, 8, 27, 14, 30)));
    expect(d.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
