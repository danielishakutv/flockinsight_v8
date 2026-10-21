import { describe, expect, it } from "vitest";
import { dayKeyIn, daysCovered } from "@/lib/calendar-days";

/*
 * Without a zone these read the machine's local clock, exactly as the
 * facilities calendar always did, so the dates are built from local parts
 * and the test holds in any zone the suite runs in.
 */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("days an entry covers, on the browser's clock", () => {
  it("covers every day a multi-day booking touches", () => {
    expect(daysCovered(local(2026, 11, 3, 9), local(2026, 11, 5, 17))).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
  });

  it("does not spill into a day it ends at exactly midnight", () => {
    expect(daysCovered(local(2026, 11, 3, 9), local(2026, 11, 5, 0))).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("keeps a zero-length midnight entry on its own day", () => {
    expect(daysCovered(local(2026, 11, 3), local(2026, 11, 3))).toEqual(["2026-11-03"]);
  });
});

describe("days an entry covers, in the church's zone", () => {
  it("puts a 23:30 UTC start in Lagos on the next day", () => {
    expect(daysCovered("2026-11-02T23:30:00Z", "2026-11-03T00:30:00Z", "Africa/Lagos")).toEqual(["2026-11-03"]);
    expect(dayKeyIn(new Date("2026-11-02T23:30:00Z"), "Africa/Lagos")).toBe("2026-11-03");
  });

  it("applies the midnight rule on the church's wall clock", () => {
    // 09:00 Tuesday to 00:00 Thursday, Lagos time.
    expect(daysCovered("2026-11-03T08:00:00Z", "2026-11-04T23:00:00Z", "Africa/Lagos")).toEqual([
      "2026-11-03",
      "2026-11-04",
    ]);
  });
});
