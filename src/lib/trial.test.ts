import { describe, expect, it } from "vitest";
import {
  computeStanding,
  trialEndDate,
  waiverActive,
  waiverEndDate,
} from "./trial";

const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("trialEndDate", () => {
  it("counts a Sunday start as the first free Sunday", () => {
    // 2026-10-04 is a Sunday; 7 Sundays from it ends on 2026-11-15.
    const end = trialEndDate(new Date("2026-10-04T09:00:00.000Z"), 7);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(10); // November
    expect(end.getDate()).toBe(15);
  });
});

describe("waiverActive", () => {
  it("is false without the flag, whatever the date says", () => {
    expect(
      waiverActive({ paymentWaived: false, paymentWaivedUntil: new Date("2030-01-01") }, NOW),
    ).toBe(false);
  });

  it("treats no end date as indefinite", () => {
    expect(waiverActive({ paymentWaived: true, paymentWaivedUntil: null }, NOW)).toBe(true);
  });

  it("is false once the deadline has passed", () => {
    expect(
      waiverActive({ paymentWaived: true, paymentWaivedUntil: new Date("2026-09-30") }, NOW),
    ).toBe(false);
  });

  it("is true while the deadline is still ahead", () => {
    expect(
      waiverActive({ paymentWaived: true, paymentWaivedUntil: new Date("2026-12-31") }, NOW),
    ).toBe(true);
  });
});

describe("computeStanding", () => {
  it("reports a live comp, with how long is left on it", () => {
    const s = computeStanding(
      { paymentWaived: true, paymentWaivedUntil: new Date("2026-10-13T12:00:00.000Z") },
      NOW,
    );
    expect(s.state).toBe("waived");
    expect(s.gated).toBe(false);
    expect(s.waiverDaysLeft).toBe(10);
  });

  it("leaves an indefinite comp with no end date to show", () => {
    const s = computeStanding({ paymentWaived: true }, NOW);
    expect(s.state).toBe("waived");
    expect(s.waiverEndsAt).toBeNull();
    expect(s.waiverDaysLeft).toBeNull();
  });

  /*
   * The point of the whole feature: a lapsed comp must hand the church back to
   * the ordinary rules. If this ever returns "waived" again, a three-month comp
   * is a permanent one.
   */
  it("gates a church whose comp lapsed and whose trial is over", () => {
    const s = computeStanding(
      {
        paymentWaived: true,
        paymentWaivedUntil: new Date("2026-09-01T00:00:00.000Z"),
        trialEndsAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      NOW,
    );
    expect(s.state).toBe("expired");
    expect(s.gated).toBe(true);
  });

  it("falls back to a paid plan when the comp lapses mid-subscription", () => {
    const s = computeStanding(
      {
        paymentWaived: true,
        paymentWaivedUntil: new Date("2026-09-01T00:00:00.000Z"),
        planRenewsAt: new Date("2026-11-01T00:00:00.000Z"),
        trialEndsAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      NOW,
    );
    expect(s.state).toBe("paid");
    expect(s.gated).toBe(false);
  });

  it("never gates a church with no trial set (grandfathered)", () => {
    const s = computeStanding({}, NOW);
    expect(s.state).toBe("none");
    expect(s.gated).toBe(false);
  });
});

describe("waiverEndDate", () => {
  it("returns null for no end date", () => {
    expect(waiverEndDate(0, NOW)).toBeNull();
  });

  it("adds calendar months", () => {
    const end = waiverEndDate(3, new Date("2026-10-03T12:00:00.000Z"))!;
    expect(end.getMonth()).toBe(0); // January
    expect(end.getFullYear()).toBe(2027);
    expect(end.getDate()).toBe(3);
  });

  /*
   * 31 August + 6 months has no 31st to land on. Plain month arithmetic rolls
   * into March and quietly gives the church an extra three days of free use
   * every time; this clamps to the end of February instead.
   */
  it("clamps to the last day of a shorter month", () => {
    const end = waiverEndDate(6, new Date("2026-08-31T10:00:00.000Z"))!;
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBeGreaterThanOrEqual(28);
    expect(end.getDate()).toBeLessThanOrEqual(29);
  });
});
