import { describe, expect, it } from "vitest";
import {
  localHour,
  localMinutesOfDay,
  minutesFromHHMM,
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

/*
 * These two exist because the first-timer sequence stored "send at 10:00" and
 * then never read it — so its sends fired whenever the daily cron did, which
 * on a UTC box is the small hours in Lagos, outside the hours SMS may be
 * delivered. The comparison the gate needs is minutes-since-local-midnight.
 */
describe("localMinutesOfDay", () => {
  it("is the wall clock where the church is, not on the server", () => {
    const at = new Date("2026-10-05T09:00:00Z");
    expect(localMinutesOfDay(at, LAGOS)).toBe(10 * 60); // 10:00 in Lagos
    expect(localMinutesOfDay(at, MAPUTO)).toBe(11 * 60); // 11:00 in Maputo
  });

  it("keeps the minutes, not just the hour", () => {
    expect(localMinutesOfDay(new Date("2026-10-05T09:37:00Z"), LAGOS)).toBe(
      10 * 60 + 37,
    );
  });

  it("reads local midnight as zero rather than 24 hours", () => {
    // 23:00Z is 00:00 the next day in Lagos; Intl can report that hour as 24.
    expect(localMinutesOfDay(new Date("2026-10-05T23:00:00Z"), LAGOS)).toBe(0);
  });

  it("follows DST rather than a fixed offset", () => {
    expect(localMinutesOfDay(new Date("2026-07-01T09:00:00Z"), LONDON)).toBe(
      10 * 60,
    );
    expect(localMinutesOfDay(new Date("2026-01-01T09:00:00Z"), LONDON)).toBe(
      9 * 60,
    );
  });

  it("falls back to the home zone rather than throwing on a bad timezone", () => {
    const at = new Date("2026-10-05T09:00:00Z");
    expect(localMinutesOfDay(at, "Not/AZone")).toBe(
      localMinutesOfDay(at, LAGOS),
    );
  });
});

describe("minutesFromHHMM", () => {
  it("reads the stored setting", () => {
    expect(minutesFromHHMM("10:00")).toBe(600);
    expect(minutesFromHHMM("08:30")).toBe(510);
    expect(minutesFromHHMM("00:00")).toBe(0);
    expect(minutesFromHHMM("23:59")).toBe(1439);
  });

  it("treats nonsense as midnight, so the gate opens rather than jams shut", () => {
    expect(minutesFromHHMM("")).toBe(0);
    expect(minutesFromHHMM("nonsense")).toBe(0);
    // An hour with no minutes is still an hour.
    expect(minutesFromHHMM("9")).toBe(540);
  });
});

describe("the first-timer send gate", () => {
  // The gate the sequence applies: send once the local clock reaches sendTime.
  const open = (at: string, tz: string, sendTime: string) =>
    localMinutesOfDay(new Date(at), tz) >= minutesFromHHMM(sendTime);

  it("stays shut before the church's hour and opens at it", () => {
    expect(open("2026-10-05T08:59:00Z", LAGOS, "10:00")).toBe(false);
    expect(open("2026-10-05T09:00:00Z", LAGOS, "10:00")).toBe(true);
  });

  it("opens inside the SMS window for any sane send time", () => {
    // The point of the gate: a 10:00 local send can never land at 2am.
    for (const tz of [LAGOS, MAPUTO, LONDON]) {
      let firstOpen: Date | null = null;
      for (let h = 0; h < 24 && !firstOpen; h++) {
        const at = new Date(Date.UTC(2026, 9, 5, h, 0, 0));
        if (open(at.toISOString(), tz, "10:00")) firstOpen = at;
      }
      expect(firstOpen, tz).not.toBeNull();
      expect(withinSmsWindow(firstOpen!, tz), tz).toBe(true);
    }
  });
});
