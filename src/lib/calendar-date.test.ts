import { describe, expect, it } from "vitest";
import { isRealCalendarDate, todayIso } from "@/lib/calendar-date";
import { parseRange } from "@/lib/report-range";

/**
 * The one thing JavaScript does here that everybody gets wrong:
 *
 *     new Date("2026-02-31T00:00:00.000Z")   // -> 2026-03-03
 *
 * `Date` rolls over instead of failing, so a `Number.isNaN(...getTime())`
 * check passes an impossible date through. Two places in this codebase did
 * exactly that, one of them under a comment claiming it rejected 2026-02-31.
 */

describe("isRealCalendarDate", () => {
  it("accepts ordinary dates", () => {
    for (const d of ["2026-10-06", "2000-01-01", "1999-12-31"]) {
      expect(isRealCalendarDate(d), d).toBe(true);
    }
  });

  it("rejects the days that do not exist, which Date silently moves", () => {
    for (const d of ["2026-02-31", "2026-02-30", "2026-04-31", "2026-06-31"]) {
      expect(isRealCalendarDate(d), `${d} should not exist`).toBe(false);
    }
  });

  it("knows which Februaries have a 29th", () => {
    expect(isRealCalendarDate("2024-02-29")).toBe(true); // leap
    expect(isRealCalendarDate("2000-02-29")).toBe(true); // divisible by 400
    expect(isRealCalendarDate("2026-02-29")).toBe(false);
    expect(isRealCalendarDate("1900-02-29")).toBe(false); // the century rule
  });

  it("rejects months and days outside the calendar at all", () => {
    for (const d of ["2026-13-01", "2026-00-10", "2026-01-32", "2026-01-00"]) {
      expect(isRealCalendarDate(d), d).toBe(false);
    }
  });

  it("rejects anything not shaped like a date", () => {
    for (const d of ["", "2026-1-5", "06/10/2026", "yesterday", "2026-10-06T00:00:00Z"]) {
      expect(isRealCalendarDate(d), d).toBe(false);
    }
  });
});

describe("todayIso", () => {
  it("reads the local parts, not UTC", () => {
    /*
     * `toISOString().slice(0,10)` converts to UTC first, so late in the
     * evening west of Greenwich it reports yesterday. A visitor registered at
     * 9pm in Toronto would be filed as having come the day before.
     */
    const lateEvening = new Date(2026, 9, 6, 23, 30);
    expect(todayIso(lateEvening)).toBe("2026-10-06");
  });

  it("pads single-digit months and days", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("report ranges, which had the bug", () => {
  const range = (from: string, to: string) =>
    parseRange(new URLSearchParams({ from, to }));

  it("drops an impossible date instead of sending it to Postgres", () => {
    // Before the fix this returned { from: "2026-02-31" }, and the query it
    // built aborted with a date/time field value out of range.
    expect(range("2026-02-31", "2026-03-31").from).toBeNull();
  });

  it("still accepts a real range", () => {
    expect(range("2026-01-01", "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("still swaps a backwards range", () => {
    expect(range("2026-03-31", "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("accepts a leap day, which a naive month-length check would refuse", () => {
    expect(range("2024-02-29", "2024-03-01").from).toBe("2024-02-29");
  });
});
