import { afterEach, describe, expect, it } from "vitest";
import { endOfLocalDay, parseWallClockInput, toWallClockInput } from "@/lib/wall-clock-input";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("a time a church types is read in the church's timezone", () => {
  it("reads 18:30 in Nairobi as 15:30 UTC", () => {
    expect(parseWallClockInput("2026-10-14T18:30", "Africa/Nairobi")?.toISOString()).toBe(
      "2026-10-14T15:30:00.000Z",
    );
  });

  it("reads 18:30 in Lagos as 17:30 UTC", () => {
    expect(parseWallClockInput("2026-10-14T18:30", "Africa/Lagos")?.toISOString()).toBe(
      "2026-10-14T17:30:00.000Z",
    );
  });

  it("gives the same answer whatever zone the server is in", () => {
    // The whole bug: `new Date("…T18:30")` follows the process's own clock.
    const answers = new Set<string>();
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Africa/Nairobi"]) {
      process.env.TZ = tz;
      answers.add(parseWallClockInput("2026-10-14T18:30", "Africa/Nairobi")!.toISOString());
    }
    expect([...answers]).toEqual(["2026-10-14T15:30:00.000Z"]);
  });

  it("round-trips, so opening and saving the edit dialog changes nothing", () => {
    const at = parseWallClockInput("2026-03-29T07:45", "Europe/London")!;
    expect(toWallClockInput(at, "Europe/London")).toBe("2026-03-29T07:45");
    const again = parseWallClockInput(toWallClockInput(at, "Europe/London"), "Europe/London");
    expect(again?.getTime()).toBe(at.getTime());
  });

  it("refuses a time that does not exist there rather than inventing another", () => {
    // Clocks in London go from 01:00 to 02:00 on 29 March 2026.
    expect(parseWallClockInput("2026-03-29T01:30", "Europe/London")).toBeNull();
    expect(parseWallClockInput("2026-02-30T10:00", "Africa/Lagos")).toBeNull();
    expect(parseWallClockInput("not a date", "Africa/Lagos")).toBeNull();
    expect(parseWallClockInput("2026-10-14T25:00", "Africa/Lagos")).toBeNull();
  });

  it("takes a string that already names its zone as the instant it says", () => {
    expect(parseWallClockInput("2026-10-14T18:30:00.000Z", "Africa/Nairobi")?.toISOString()).toBe(
      "2026-10-14T18:30:00.000Z",
    );
    expect(parseWallClockInput("2026-10-14T18:30+01:00", "Africa/Nairobi")?.toISOString()).toBe(
      "2026-10-14T17:30:00.000Z",
    );
  });

  it("ends a repeat at the last moment of that day in the church's zone", () => {
    expect(endOfLocalDay("2026-10-31", "Africa/Nairobi")?.toISOString()).toBe(
      "2026-10-31T20:59:59.999Z",
    );
    expect(endOfLocalDay("2026-10-31T00:00", "Africa/Nairobi")).toBeNull();
  });
});
