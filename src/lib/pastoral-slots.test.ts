import { describe, expect, it } from "vitest";
import type { ClashCandidate } from "@/lib/facility-shared";
import { wallClockIn } from "@/lib/meeting-recurrence";
import {
  fitsHours,
  generateSlots,
  isOfferedSlot,
  localDayKeys,
  todayKey,
  wallInputToIso,
  type Busy,
  type SlotRules,
} from "@/lib/pastoral-slots";

/*
 * Lagos is UTC+1 all year, so local 09:00 is 08:00Z. 2026-11-02 is a Monday.
 * New York crosses daylight saving on 2026-03-08 (spring) and 2026-11-01 (fall).
 */

const LAGOS = "Africa/Lagos";
const MONDAY = "2026-11-02";
const SUNDAY_NIGHT = new Date("2026-11-01T00:00:00Z");

const base = (over: Partial<SlotRules> = {}): SlotRules => ({
  timeZone: LAGOS,
  hours: [{ weekday: 1, startMinute: 540, endMinute: 720 }],
  slotMinutes: 30,
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 30,
  ...over,
});

const free: Busy = { appointments: [], closures: [] };

const appt = (id: string, startsAt: string, holdsUntil: string): ClashCandidate => ({
  id,
  label: "Counselling",
  sort: "booking",
  startsAt,
  endsAt: holdsUntil,
});
const closure = (startsAt: string, endsAt: string): ClashCandidate => ({
  id: "c1",
  label: "Leave",
  sort: "closure",
  startsAt,
  endsAt,
});

const starts = (rules: SlotRules, busy: Busy = free, now = SUNDAY_NIGHT, fromDay = MONDAY, days = 1) =>
  generateSlots(rules, busy, { now, fromDay, days }).map((s) => s.startsAt);

describe("the grid", () => {
  it("steps through a window by the slot length", () => {
    expect(starts(base())).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T08:30:00.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T09:30:00.000Z",
      "2026-11-02T10:00:00.000Z",
      "2026-11-02T10:30:00.000Z",
    ]);
  });

  it("offers a long appointment on the slot grid, but only where it still fits", () => {
    const got = starts(base({ durationMinutes: 60 }));
    expect(got).toHaveLength(5);
    expect(got.at(-1)).toBe("2026-11-02T10:00:00.000Z"); // 11:00 local, ends 12:00
  });

  it("does not offer a slot the end of the window cannot hold", () => {
    const got = starts(base({ hours: [{ weekday: 1, startMinute: 540, endMinute: 645 }] }));
    expect(got).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T08:30:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
  });

  it("gives nothing for a day that is not in the calendar", () => {
    expect(generateSlots(base(), free, { now: SUNDAY_NIGHT, fromDay: "2026-02-31", days: 3 })).toEqual([]);
    expect(localDayKeys("2026-02-31", 3)).toEqual([]);
  });
});

describe("what blocks a slot", () => {
  it("an existing appointment's buffer blocks the next slot, but not one starting exactly when it ends", () => {
    // 09:00-09:30 local, held until 10:00 by a 30-minute buffer.
    const busy: Busy = { appointments: [appt("a1", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z")], closures: [] };
    const got = starts(base(), busy);
    expect(got).not.toContain("2026-11-02T08:30:00.000Z");
    expect(got).toContain("2026-11-02T09:00:00.000Z");
  });

  it("the proposed appointment's own buffer must not run into the next one", () => {
    const busy: Busy = { appointments: [appt("a1", "2026-11-02T09:00:00Z", "2026-11-02T09:30:00Z")], closures: [] };
    const got = starts(base({ bufferMinutes: 30 }), busy);
    expect(got).not.toContain("2026-11-02T08:30:00.000Z"); // 09:30-10:00, held to 10:30
    expect(got).toContain("2026-11-02T08:00:00.000Z"); // held until exactly 10:00 local
  });

  it("a closure blocks what overlaps it and nothing that only touches it", () => {
    const busy: Busy = { appointments: [], closures: [closure("2026-11-02T09:00:00Z", "2026-11-02T10:00:00Z")] };
    const got = starts(base(), busy);
    expect(got).toContain("2026-11-02T08:30:00.000Z");
    expect(got).not.toContain("2026-11-02T09:00:00.000Z");
    expect(got).not.toContain("2026-11-02T09:30:00.000Z");
    expect(got).toContain("2026-11-02T10:00:00.000Z");
  });

  it("respects the minimum notice", () => {
    const now = new Date("2026-11-02T08:10:00Z"); // 09:10 local
    expect(starts(base({ minNoticeMinutes: 60 }), free, now)[0]).toBe("2026-11-02T09:30:00.000Z");
  });

  it("respects how far ahead people may book", () => {
    const now = new Date("2026-11-01T09:00:00Z");
    expect(starts(base({ maxAdvanceDays: 1 }), free, now)).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T08:30:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
  });
});

describe("the church's own calendar", () => {
  it("counts 00:30 on Monday in Lagos as Monday, though it is Sunday in UTC", () => {
    const slots = generateSlots(base({ hours: [{ weekday: 1, startMinute: 0, endMinute: 60 }] }), free, {
      now: new Date("2026-10-30T00:00:00Z"),
      fromDay: MONDAY,
      days: 1,
    });
    expect(slots.map((s) => s.startsAt)).toContain("2026-11-01T23:30:00.000Z");
    expect(slots.every((s) => s.dayKey === MONDAY)).toBe(true);
  });

  it("offers no time that does not exist when New York springs forward", () => {
    const rules = base({
      timeZone: "America/New_York",
      hours: [{ weekday: 0, startMinute: 60, endMinute: 240 }],
    });
    const slots = generateSlots(rules, free, {
      now: new Date("2026-03-01T00:00:00Z"),
      fromDay: "2026-03-08",
      days: 1,
    });
    const walls = slots.map((s) => {
      const w = wallClockIn(new Date(s.startsAt), "America/New_York");
      return `${w.hour}:${String(w.minute).padStart(2, "0")}`;
    });
    expect(walls).toEqual(["1:00", "1:30", "3:00", "3:30"]);
  });

  it("offers each time once when New York falls back", () => {
    const rules = base({
      timeZone: "America/New_York",
      hours: [{ weekday: 0, startMinute: 0, endMinute: 180 }],
    });
    const slots = generateSlots(rules, free, {
      now: new Date("2026-10-25T00:00:00Z"),
      fromDay: "2026-11-01",
      days: 1,
    });
    const iso = slots.map((s) => s.startsAt);
    expect(new Set(iso).size).toBe(iso.length);
    expect(iso).toHaveLength(6);
  });

  it("never covers more than fourteen days in one request", () => {
    const every = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 600 }));
    const slots = generateSlots(base({ hours: every, maxAdvanceDays: 90 }), free, {
      now: SUNDAY_NIGHT,
      fromDay: MONDAY,
      days: 60,
    });
    expect(new Set(slots.map((s) => s.dayKey)).size).toBe(14);
  });

  it("reads today in the church's zone", () => {
    expect(todayKey(new Date("2026-11-01T23:30:00Z"), LAGOS)).toBe("2026-11-02");
  });
});

describe("isOfferedSlot: the server's only way to accept a time", () => {
  const rules = base();

  it("accepts a time the generator offers, with the hold worked out by the server", () => {
    const slot = isOfferedSlot(base({ bufferMinutes: 15 }), free, "2026-11-02T08:30:00.000Z", SUNDAY_NIGHT);
    expect(slot?.endsAt).toBe("2026-11-02T09:00:00.000Z");
    expect(slot?.holdsUntil).toBe("2026-11-02T09:15:00.000Z");
  });

  it("refuses an off-grid time, one outside the hours and one inside a closure", () => {
    expect(isOfferedSlot(rules, free, "2026-11-02T08:07:00.000Z", SUNDAY_NIGHT)).toBeNull();
    expect(isOfferedSlot(rules, free, "2026-11-02T02:00:00.000Z", SUNDAY_NIGHT)).toBeNull();
    const shut: Busy = { appointments: [], closures: [closure("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z")] };
    expect(isOfferedSlot(rules, shut, "2026-11-02T08:30:00.000Z", SUNDAY_NIGHT)).toBeNull();
    expect(isOfferedSlot(rules, free, "not a date", SUNDAY_NIGHT)).toBeNull();
  });

  it("lets an appointment be moved onto its own time when it is ignored", () => {
    const busy: Busy = { appointments: [appt("a1", "2026-11-02T08:00:00Z", "2026-11-02T08:30:00Z")], closures: [] };
    expect(isOfferedSlot(rules, busy, "2026-11-02T08:00:00.000Z", SUNDAY_NIGHT)).toBeNull();
    expect(isOfferedSlot(rules, busy, "2026-11-02T08:00:00.000Z", SUNDAY_NIGHT, { ignoreId: "a1" })).not.toBeNull();
  });
});

describe("fitsHours and wall-clock input", () => {
  const hours = [{ weekday: 1, startMinute: 540, endMinute: 720 }];

  it("says whether an appointment sits inside the hours on the church's clock", () => {
    expect(fitsHours("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", hours, LAGOS)).toBe(true);
    expect(fitsHours("2026-11-02T10:30:00Z", "2026-11-02T11:30:00Z", hours, LAGOS)).toBe(false);
  });

  it("reads a datetime-local value in the church's zone, never the browser's", () => {
    expect(wallInputToIso("2026-11-02T09:30", LAGOS)).toBe("2026-11-02T08:30:00.000Z");
    expect(wallInputToIso("2026-02-31T09:30", LAGOS)).toBeNull();
    expect(wallInputToIso("09:30", LAGOS)).toBeNull();
  });
});
