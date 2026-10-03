import { describe, expect, it } from "vitest";
import {
  localHour,
  nextSmsWindowStart,
  smsWindowNotice,
  withinSmsWindow,
} from "./sms-window";

const LAGOS = "Africa/Lagos"; // UTC+1, no DST
const MAPUTO = "Africa/Maputo"; // UTC+2, no DST
const LONDON = "Europe/London"; // UTC+0/+1, has DST

describe("withinSmsWindow", () => {
  it("is open at 8am local and shut at 8pm local", () => {
    // 07:00Z is 08:00 in Lagos.
    expect(withinSmsWindow(new Date("2026-10-03T07:00:00Z"), LAGOS)).toBe(true);
    // 19:00Z is 20:00 in Lagos — the window has just shut.
    expect(withinSmsWindow(new Date("2026-10-03T19:00:00Z"), LAGOS)).toBe(false);
    // 18:59Z is 19:59 — the last minute it is open.
    expect(withinSmsWindow(new Date("2026-10-03T18:59:00Z"), LAGOS)).toBe(true);
  });

  /*
   * The whole reason this is not a UTC comparison. At 06:30Z it is 07:30 in
   * Lagos (shut) and 08:30 in Maputo (open) — one instant, two answers.
   */
  it("answers per church, not per server", () => {
    const at = new Date("2026-10-03T06:30:00Z");
    expect(withinSmsWindow(at, LAGOS)).toBe(false);
    expect(withinSmsWindow(at, MAPUTO)).toBe(true);
  });

  it("falls back to Lagos for a timezone nobody recognises", () => {
    expect(localHour(new Date("2026-10-03T07:00:00Z"), "Mars/Olympus")).toBe(8);
    expect(withinSmsWindow(new Date("2026-10-03T07:00:00Z"), "")).toBe(true);
  });
});

describe("nextSmsWindowStart", () => {
  it("returns the same instant when the window is open", () => {
    const at = new Date("2026-10-03T10:00:00Z"); // 11am Lagos
    expect(nextSmsWindowStart(at, LAGOS).getTime()).toBe(at.getTime());
  });

  it("waits until later today when it is too early", () => {
    // 04:00Z = 05:00 Lagos → 08:00 Lagos is 07:00Z the same day.
    const next = nextSmsWindowStart(new Date("2026-10-03T04:00:00Z"), LAGOS);
    expect(next.toISOString()).toBe("2026-10-03T07:00:00.000Z");
  });

  it("waits until tomorrow morning when it is too late", () => {
    // 21:30Z = 22:30 Lagos → next 8am Lagos is 07:00Z on the 4th.
    const next = nextSmsWindowStart(new Date("2026-10-03T21:30:00Z"), LAGOS);
    expect(next.toISOString()).toBe("2026-10-04T07:00:00.000Z");
  });

  /*
   * 23:30 Lagos on the 31st is already the 1st in UTC. Adding a day to the
   * wrong clock is how a message gets queued for the wrong month.
   */
  it("crosses a month boundary correctly", () => {
    const next = nextSmsWindowStart(new Date("2026-10-31T22:30:00Z"), LAGOS);
    expect(next.toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const next = nextSmsWindowStart(new Date("2026-12-31T22:30:00Z"), LAGOS);
    expect(next.toISOString()).toBe("2027-01-01T07:00:00.000Z");
  });

  it("gets 8am right in a zone that observes DST", () => {
    // 1 July: London is UTC+1, so 08:00 local is 07:00Z.
    expect(
      nextSmsWindowStart(new Date("2026-07-01T02:00:00Z"), LONDON).toISOString(),
    ).toBe("2026-07-01T07:00:00.000Z");
    // 1 January: London is UTC+0, so 08:00 local is 08:00Z.
    expect(
      nextSmsWindowStart(new Date("2026-01-01T02:00:00Z"), LONDON).toISOString(),
    ).toBe("2026-01-01T08:00:00.000Z");
  });

  it("always lands inside the window it points at", () => {
    // Every hour of a day, from either zone, must resolve to a sendable moment.
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 9, 3, h, 17, 0));
      for (const tz of [LAGOS, MAPUTO, LONDON]) {
        expect(withinSmsWindow(nextSmsWindowStart(at, tz), tz)).toBe(true);
      }
    }
  });
});

describe("smsWindowNotice", () => {
  it("names the day and time the message will go", () => {
    const notice = smsWindowNotice(new Date("2026-10-04T07:00:00Z"), LAGOS);
    expect(notice).toContain("Sunday");
    expect(notice).toContain("8:00");
    expect(notice).toContain("Nothing is charged");
  });
});
