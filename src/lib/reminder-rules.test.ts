import { describe, expect, it } from "vitest";
import {
  WEEKEND_LAPSE_GRACE_DAYS,
  lastSaturday,
  shouldRemind,
  type ReminderInput,
} from "@/lib/reminder-rules";

/**
 * The rules that decide whether somebody's Monday starts with a reproach.
 *
 * The cases that matter are all about NOT sending: a church that never began,
 * and a church that stopped months ago, must both be left alone — while a
 * church that genuinely missed last Sunday still hears about it once.
 */

// A Monday.
const MONDAY = new Date("2026-09-28T09:00:00Z");

const base: ReminderInput = {
  health: "healthy",
  lastAtt: null,
  lastGiv: null,
  lastMem: null,
  lastLogin: null,
  now: MONDAY,
};

/** "YYYY-MM-DD" n days before `now`. */
function daysAgo(n: number, now: Date = MONDAY): string {
  const d = new Date(now.getTime() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("lastSaturday", () => {
  it("is the Saturday two days before a Monday", () => {
    expect(lastSaturday(MONDAY)).toBe("2026-09-26");
  });
});

describe("shouldRemind — the churches that must be left alone", () => {
  it("sends a never-activated church nothing at all on a Monday", () => {
    // The bug this module exists for. Nine of fourteen churches sat here,
    // collecting "you haven't recorded attendance" every Monday for months.
    expect(
      shouldRemind({
        ...base,
        health: "never_activated",
        lastMem: new Date("2026-09-12T10:00:00Z"),
      }),
    ).toBeNull();
  });

  it("sends a never-activated church nothing even when everything else would fire", () => {
    expect(
      shouldRemind({
        ...base,
        health: "never_activated",
        lastMem: new Date(MONDAY.getTime() - 7.5 * 86_400_000),
        lastLogin: new Date(MONDAY.getTime() - 3.5 * 86_400_000),
      }),
    ).toBeNull();
  });

  it("leaves a suspended church alone", () => {
    expect(shouldRemind({ ...base, health: "suspended", lastAtt: daysAgo(9) })).toBeNull();
  });

  it("stops nagging a church that lapsed long ago", () => {
    // `lastAtt < lastSaturday` stays true for ever once a church goes quiet.
    // Without the grace window this fired every Monday until the account died.
    expect(
      shouldRemind({ ...base, health: "dormant", lastAtt: daysAgo(200) }),
    ).toBeNull();
  });

  it("stops at the edge of the grace window", () => {
    const justOutside = WEEKEND_LAPSE_GRACE_DAYS + 1;
    expect(shouldRemind({ ...base, lastAtt: daysAgo(justOutside) })).toBeNull();
  });
});

describe("shouldRemind — the reminders that must still arrive", () => {
  it("tells a recording church it missed last Sunday", () => {
    expect(shouldRemind({ ...base, lastAtt: daysAgo(9) })).toBe("weekend");
  });

  it("still fires at the last day of the grace window", () => {
    expect(shouldRemind({ ...base, lastAtt: daysAgo(WEEKEND_LAPSE_GRACE_DAYS) })).toBe(
      "weekend",
    );
  });

  it("says nothing when this weekend is already recorded", () => {
    expect(shouldRemind({ ...base, lastAtt: "2026-09-27" })).toBeNull();
  });

  it("does not send the weekend reminder on other days", () => {
    const tuesday = new Date("2026-09-29T09:00:00Z");
    expect(
      shouldRemind({ ...base, lastAtt: daysAgo(9, tuesday), now: tuesday }),
    ).toBeNull();
  });

  it("flags a whole quiet week, once", () => {
    const quiet = { ...base, lastMem: new Date(MONDAY.getTime() - 7.5 * 86_400_000) };
    expect(shouldRemind(quiet)).toBe("inactive");
    // A day later the window has passed and the church is not told again.
    const later = new Date(MONDAY.getTime() + 86_400_000);
    expect(shouldRemind({ ...quiet, now: later })).toBeNull();
  });

  it("puts a quiet week ahead of a missed Sunday", () => {
    expect(
      shouldRemind({
        ...base,
        lastAtt: daysAgo(7.5) ,
        lastMem: new Date(MONDAY.getTime() - 7.5 * 86_400_000),
      }),
    ).toBe("inactive");
  });

  it("nudges an owner who has not logged in for a few days", () => {
    expect(
      shouldRemind({
        ...base,
        lastLogin: new Date(MONDAY.getTime() - 3.5 * 86_400_000),
      }),
    ).toBe("login");
  });

  it("says nothing to a church that is busy and present", () => {
    expect(
      shouldRemind({
        ...base,
        lastAtt: "2026-09-27",
        lastLogin: new Date(MONDAY.getTime() - 3_600_000),
      }),
    ).toBeNull();
  });
});
