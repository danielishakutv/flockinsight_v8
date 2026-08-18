import { describe, expect, it } from "vitest";
import {
  ALL,
  parseBranchFilters,
  rangeLabel,
  rangeStart,
} from "./branches-shared";

describe("rangeStart", () => {
  // Local-time constructor: "this month" is about the reader's calendar.
  const now = new Date(2026, 7, 18, 9, 30); // 18 Aug 2026

  it("counts back a fixed number of days", () => {
    expect(rangeStart("30d", now).toISOString().slice(0, 10)).toBe("2026-07-19");
    expect(rangeStart("90d", now).toISOString().slice(0, 10)).toBe("2026-05-20");
  });

  it("starts this month on the first", () => {
    const start = rangeStart("mtd", now);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(7);
    expect(start.getFullYear()).toBe(2026);
  });

  it("starts this year in January", () => {
    const start = rangeStart("ytd", now);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  it("falls back to 30 days for anything unexpected", () => {
    // A hand-edited URL should not produce an invalid date.
    const start = rangeStart("nonsense" as never, now);
    expect(start.toISOString().slice(0, 10)).toBe("2026-07-19");
  });
});

describe("rangeLabel", () => {
  it("names the range", () => {
    expect(rangeLabel("mtd")).toBe("This month");
    expect(rangeLabel("12m")).toBe("Last 12 months");
  });
});

describe("parseBranchFilters", () => {
  it("defaults to the last 30 days and no filtering", () => {
    expect(parseBranchFilters({})).toEqual({
      range: "30d",
      zone: ALL,
      state: ALL,
      city: ALL,
      country: ALL,
      q: "",
    });
  });

  it("reads what the dashboard put in the URL", () => {
    expect(
      parseBranchFilters({
        range: "ytd",
        zone: "North Zone",
        state: "Adamawa",
        city: "Yola",
        country: "Nigeria",
        q: "  grace  ",
      }),
    ).toEqual({
      range: "ytd",
      zone: "North Zone",
      state: "Adamawa",
      city: "Yola",
      country: "Nigeria",
      q: "grace",
    });
  });

  it("ignores a range that isn't one of ours", () => {
    expect(parseBranchFilters({ range: "'; drop table church" }).range).toBe("30d");
  });

  it("treats a blank filter as no filter", () => {
    const f = parseBranchFilters({ zone: "   ", city: "" });
    expect(f.zone).toBe(ALL);
    expect(f.city).toBe(ALL);
  });
});
