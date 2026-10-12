import { describe, expect, it } from "vitest";
import { convertRemainingMs, nextRenewal, rollbackRenewal } from "@/lib/plan-period";

/**
 * Where the renewal date lands after a payment, and after a void. Each case
 * here is a way a church used to lose paid time, or gain time it never paid
 * for.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-03-15T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const base = {
  now: NOW,
  currentPlan: "growth",
  renewsAt: null,
  trialEndsAt: null,
  plan: "growth",
  months: 1,
  currentMonthly: 10_000,
  newMonthly: 10_000,
  convertRemaining: true,
};

describe("nextRenewal", () => {
  it("starts a first payment today", () => {
    const r = nextRenewal(base);
    expect(r.renewsAt.toISOString()).toBe("2026-04-15T12:00:00.000Z");
    expect(r.conversion).toBeNull();
  });

  it("renews early from the current renewal date, never from today", () => {
    const r = nextRenewal({ ...base, renewsAt: days(20) });
    const expected = days(20);
    expected.setMonth(expected.getMonth() + 1);
    expect(r.renewsAt).toEqual(expected);
  });

  it("switches monthly to annual on the same plan without losing the month left", () => {
    const r = nextRenewal({ ...base, renewsAt: days(20), months: 12 });
    const expected = days(20);
    expected.setMonth(expected.getMonth() + 12);
    expect(r.renewsAt).toEqual(expected);
  });

  it("never throws away the rest of a free trial", () => {
    // The bug: paying on the second Sunday started the month that day, so it
    // ended before the trial would have.
    const r = nextRenewal({ ...base, trialEndsAt: days(35) });
    const expected = days(35);
    expected.setMonth(expected.getMonth() + 1);
    expect(r.renewsAt).toEqual(expected);
  });

  it("does not stack a trial on top of paid time that already covers it", () => {
    const r = nextRenewal({ ...base, renewsAt: days(60), trialEndsAt: days(10) });
    const expected = days(60);
    expected.setMonth(expected.getMonth() + 1);
    expect(r.renewsAt).toEqual(expected);
  });

  it("does not turn a year of cheap Starter into a year of Pro for one Pro month", () => {
    const r = nextRenewal({
      ...base,
      currentPlan: "starter",
      plan: "pro",
      renewsAt: days(340),
      currentMonthly: 5000,
      newMonthly: 25_000,
    });
    // 340 days at a fifth of the price is 68 days of Pro, plus the month bought.
    const expected = days(68);
    expected.setMonth(expected.getMonth() + 1);
    expect(Math.abs(r.renewsAt.getTime() - expected.getTime())).toBeLessThan(DAY);
    expect(r.conversion).toEqual({ fromPlan: "starter", fromDays: 340, toDays: 68 });
  });

  it("does not forfeit a paid year of Pro on a downgrade", () => {
    const r = nextRenewal({
      ...base,
      currentPlan: "pro",
      plan: "starter",
      renewsAt: days(300),
      currentMonthly: 25_000,
      newMonthly: 5000,
    });
    expect(r.conversion?.toDays).toBe(1500);
  });

  it("leaves a superadmin grant exactly as typed", () => {
    const r = nextRenewal({
      ...base,
      currentPlan: "starter",
      plan: "pro",
      renewsAt: days(100),
      currentMonthly: 5000,
      newMonthly: 25_000,
      convertRemaining: false,
    });
    expect(r.conversion).toBeNull();
    const expected = days(100);
    expected.setMonth(expected.getMonth() + 1);
    expect(r.renewsAt).toEqual(expected);
  });
});

describe("convertRemainingMs", () => {
  it("keeps the days when either side is a custom price", () => {
    expect(convertRemainingMs(10 * DAY, null, 25_000)).toBe(10 * DAY);
    expect(convertRemainingMs(10 * DAY, 5000, null)).toBe(10 * DAY);
  });

  it("values free time at nothing on a priced tier", () => {
    expect(convertRemainingMs(10 * DAY, 0, 25_000)).toBe(0);
  });
});

describe("rollbackRenewal", () => {
  it("winds a voided payment's months back off the date", () => {
    const renews = new Date("2027-03-15T12:00:00Z");
    expect(rollbackRenewal(renews, 12, NOW)?.toISOString()).toBe("2026-03-15T12:00:00.000Z");
  });

  it("keeps the time other payments bought", () => {
    // Two annual payments; voiding one leaves the other's year.
    const renews = new Date("2028-03-15T12:00:00Z");
    expect(rollbackRenewal(renews, 12, NOW)?.toISOString()).toBe("2027-03-15T12:00:00.000Z");
  });

  it("never winds back to before now", () => {
    const renews = days(10);
    expect(rollbackRenewal(renews, 1, NOW)).toEqual(NOW);
  });

  it("has nothing to wind back when there is no date", () => {
    expect(rollbackRenewal(null, 12, NOW)).toBeNull();
  });
});
