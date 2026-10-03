import { describe, expect, it } from "vitest";
import {
  describeRepeat,
  instantFromWallClock,
  nextOccurrence,
  ordinalDay,
  wallClockIn,
  weekdayOrdinalOf,
} from "@/lib/meeting-recurrence";

/**
 * When a repeating meeting next falls due.
 *
 * Every test here is a sentence somebody would say out loud about their own
 * church's calendar — "Wednesday prayer is at six, every week, including the
 * week the clocks change". The arithmetic is only interesting because getting it
 * wrong produces a schedule that is nearly right, which nobody reports and
 * everybody stops trusting.
 */

const LAGOS = "Africa/Lagos"; // +01:00 all year, no DST
const LONDON = "Europe/London"; // +00:00 / +01:00
const NEW_YORK = "America/New_York"; // -05:00 / -04:00

/** A local wall clock in a timezone, as an instant. Reads like the calendar. */
const at = (local: string, tz: string) => {
  const [date, time] = local.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return instantFromWallClock({ year, month, day, hour, minute }, tz);
};

/** What a timezone reads back, for comparing against the calendar. */
const reads = (d: Date | null, tz: string) => {
  if (!d) return null;
  const w = wallClockIn(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};

describe("wall clocks and instants round-trip", () => {
  it("reads back exactly what went in", () => {
    for (const tz of [LAGOS, LONDON, NEW_YORK]) {
      expect(reads(at("2026-10-07 18:30", tz), tz)).toBe("2026-10-07 18:30");
      expect(reads(at("2026-01-01 00:00", tz), tz)).toBe("2026-01-01 00:00");
      expect(reads(at("2026-12-31 23:59", tz), tz)).toBe("2026-12-31 23:59");
    }
  });

  it("puts Lagos an hour ahead of UTC", () => {
    // The sanity check on the whole offset measurement: 18:30 in Lagos is 17:30Z.
    expect(at("2026-10-07 18:30", LAGOS).toISOString()).toBe("2026-10-07T17:30:00.000Z");
  });

  it("lands midnight on the right day", () => {
    // Intl reports hour 24 rather than 0 on some engines. If that leaked through,
    // midnight would round-trip as the previous day.
    expect(reads(at("2026-03-01 00:00", LONDON), LONDON)).toBe("2026-03-01 00:00");
  });
});

describe("weekly", () => {
  it("keeps the same weekday and time", () => {
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS), // a Wednesday
      repeat: "weekly",
      timezone: LAGOS,
      after: at("2026-10-07 20:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-10-14 18:30");
  });

  it("holds the wall clock through a clock change", () => {
    /*
     * The one that matters. British clocks go back on 25 October 2026, so the
     * UTC offset either side of it differs by an hour. Adding 7×24 hours would
     * move a 6:30pm meeting to 5:30pm and nobody would know why.
     */
    const next = nextOccurrence({
      from: at("2026-10-21 18:30", LONDON),
      repeat: "weekly",
      timezone: LONDON,
      after: at("2026-10-21 20:00", LONDON),
    });
    expect(reads(next, LONDON)).toBe("2026-10-28 18:30");
    // And the instant really did move by more than seven days' worth of hours.
    expect(next!.getTime() - at("2026-10-21 18:30", LONDON).getTime()).toBe(
      (7 * 24 + 1) * 3_600_000,
    );
  });

  it("holds the wall clock across a spring-forward too", () => {
    // US clocks go forward on 8 March 2026.
    const next = nextOccurrence({
      from: at("2026-03-04 19:00", NEW_YORK),
      repeat: "weekly",
      timezone: NEW_YORK,
      after: at("2026-03-04 21:00", NEW_YORK),
    });
    expect(reads(next, NEW_YORK)).toBe("2026-03-11 19:00");
  });

  it("skips forward past occurrences that have already been missed", () => {
    /*
     * A series nobody opened for three weeks. The answer must be the next
     * Wednesday that has not happened — anything in the past would be cancelled
     * on the very next sweep and the series would never catch up.
     */
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS),
      repeat: "weekly",
      timezone: LAGOS,
      after: at("2026-10-29 09:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-11-04 18:30");
  });
});

describe("daily and fortnightly", () => {
  it("steps a day", () => {
    const next = nextOccurrence({
      from: at("2026-10-07 06:00", LAGOS),
      repeat: "daily",
      timezone: LAGOS,
      after: at("2026-10-07 07:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-10-08 06:00");
  });

  it("steps a fortnight, not two separate weeks", () => {
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS),
      repeat: "fortnightly",
      timezone: LAGOS,
      after: at("2026-10-08 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-10-21 18:30");
  });

  it("keeps the fortnight's parity when several have been missed", () => {
    // Two steps of 14 days from the 7th: the 21st, then the 4th of November.
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS),
      repeat: "fortnightly",
      timezone: LAGOS,
      after: at("2026-10-25 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-11-04 18:30");
  });
});

describe("monthly, by date", () => {
  it("keeps the day of the month", () => {
    const next = nextOccurrence({
      from: at("2026-10-05 19:00", LAGOS),
      repeat: "monthly",
      timezone: LAGOS,
      after: at("2026-10-05 21:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-11-05 19:00");
  });

  it("clamps the 31st to the end of a shorter month instead of spilling over", () => {
    // Naive date arithmetic turns 31 January into 3 March. A board meeting does
    // not move to the wrong month because February is short.
    const next = nextOccurrence({
      from: at("2027-01-31 10:00", LAGOS),
      repeat: "monthly",
      timezone: LAGOS,
      after: at("2027-02-01 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2027-02-28 10:00");
  });

  it("comes back to the 31st after a month that had to clamp", () => {
    /*
     * The reason the rule is anchored to the original date. Reading the day off
     * the clamped February occurrence would make every month afterwards the
     * 28th, and a monthly meeting would walk backwards through the calendar.
     */
    const next = nextOccurrence({
      from: at("2027-02-28 10:00", LAGOS),
      anchor: at("2027-01-31 10:00", LAGOS),
      repeat: "monthly",
      timezone: LAGOS,
      after: at("2027-03-01 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2027-03-31 10:00");
  });

  it("handles a leap February", () => {
    const next = nextOccurrence({
      from: at("2028-01-31 10:00", LAGOS),
      repeat: "monthly",
      timezone: LAGOS,
      after: at("2028-02-01 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2028-02-29 10:00");
  });
});

describe("monthly, by weekday", () => {
  it("keeps the first Sunday of the month", () => {
    // 1 November 2026 is a Sunday; 6 December 2026 is the first Sunday after it.
    const next = nextOccurrence({
      from: at("2026-11-01 09:00", LAGOS),
      repeat: "monthly-weekday",
      timezone: LAGOS,
      after: at("2026-11-01 12:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-12-06 09:00");
  });

  it("keeps the last Friday even when the count of Fridays changes", () => {
    /*
     * 30 October 2026 is the fifth Friday of October. November 2026 has only
     * four, so "the fifth" has to mean "the last" or the series would skip a
     * month — which is how a monthly vigil quietly stops happening.
     */
    const from = at("2026-10-30 22:00", LAGOS);
    expect(weekdayOrdinalOf(wallClockIn(from, LAGOS))).toEqual({ weekday: 5, ordinal: 5 });
    const next = nextOccurrence({
      from,
      repeat: "monthly-weekday",
      timezone: LAGOS,
      after: at("2026-10-31 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-11-27 22:00");
  });

  it("stays on the third Wednesday across a year boundary", () => {
    const next = nextOccurrence({
      from: at("2026-12-16 18:00", LAGOS), // the third Wednesday of December
      repeat: "monthly-weekday",
      timezone: LAGOS,
      after: at("2026-12-17 00:00", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2027-01-20 18:00");
  });
});

describe("the rule can be switched off, and can run out", () => {
  it("gives nothing for a meeting that does not repeat", () => {
    expect(
      nextOccurrence({ from: at("2026-10-07 18:30", LAGOS), repeat: "none", timezone: LAGOS }),
    ).toBeNull();
  });

  it("stops at the end date", () => {
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS),
      repeat: "weekly",
      timezone: LAGOS,
      after: at("2026-10-08 00:00", LAGOS),
      until: at("2026-10-10 00:00", LAGOS),
    });
    expect(next).toBeNull();
  });

  it("allows an occurrence that falls exactly on the end date", () => {
    const next = nextOccurrence({
      from: at("2026-10-07 18:30", LAGOS),
      repeat: "weekly",
      timezone: LAGOS,
      after: at("2026-10-08 00:00", LAGOS),
      until: at("2026-10-14 23:59", LAGOS),
    });
    expect(reads(next, LAGOS)).toBe("2026-10-14 18:30");
  });

  it("gives up rather than looping for ever on an abandoned daily series", () => {
    // Ten years of a daily meeting is past "the next one" being a useful answer.
    const next = nextOccurrence({
      from: at("2016-10-07 06:00", LAGOS),
      repeat: "daily",
      timezone: LAGOS,
      after: at("2026-10-07 06:00", LAGOS),
    });
    expect(next).toBeNull();
  });

  it("refuses a date that is not a date", () => {
    expect(
      nextOccurrence({ from: new Date("nonsense"), repeat: "weekly", timezone: LAGOS }),
    ).toBeNull();
  });
});

describe("how it reads on the card", () => {
  it("names the weekday it actually falls on", () => {
    expect(describeRepeat("weekly", at("2026-10-07 18:30", LAGOS), LAGOS)).toBe(
      "Every Wednesday",
    );
    expect(describeRepeat("fortnightly", at("2026-10-07 18:30", LAGOS), LAGOS)).toBe(
      "Every other Wednesday",
    );
    expect(describeRepeat("daily", at("2026-10-07 06:00", LAGOS), LAGOS)).toBe("Every day");
  });

  it("names the weekday as the CHURCH's timezone sees it", () => {
    /*
     * 00:30 on Thursday 7 January in Lagos is 23:30 on the Wednesday in London,
     * which is on GMT in January. A church is told which day its own meeting
     * falls on, not which day the server happens to be having.
     */
    const instant = at("2027-01-07 00:30", LAGOS);
    expect(describeRepeat("weekly", instant, LAGOS)).toBe("Every Thursday");
    expect(describeRepeat("weekly", instant, LONDON)).toBe("Every Wednesday");
  });

  it("says which day of the month, or which weekday of it", () => {
    expect(describeRepeat("monthly", at("2026-10-05 19:00", LAGOS), LAGOS)).toBe(
      "Monthly, on the 5th",
    );
    expect(describeRepeat("monthly-weekday", at("2026-11-01 09:00", LAGOS), LAGOS)).toBe(
      "Monthly, on the first Sunday",
    );
    expect(describeRepeat("monthly-weekday", at("2026-10-30 22:00", LAGOS), LAGOS)).toBe(
      "Monthly, on the last Friday",
    );
  });

  it("says nothing without a start date, because there is nothing to repeat from", () => {
    expect(describeRepeat("weekly", null, LAGOS)).toBeNull();
    expect(describeRepeat("none", at("2026-10-07 18:30", LAGOS), LAGOS)).toBeNull();
  });

  it("spells ordinals the way people write them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinalDay)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
  });
});
