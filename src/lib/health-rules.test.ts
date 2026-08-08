import { describe, expect, it } from "vitest";
import { classifyHealth, funnelFor } from "@/lib/health-rules";

const NOW = new Date("2026-08-08T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const base = {
  status: "active",
  createdAt: ago(200),
  lastSeenAt: ago(1),
  memberCount: 50,
  sessionCount: 10,
  activeWeeks: 10,
  now: NOW,
};

describe("classifyHealth", () => {
  it("suspended wins over everything else", () => {
    expect(classifyHealth({ ...base, status: "suspended" })).toBe("suspended");
  });

  it("never_activated when old with almost no members and no sessions", () => {
    expect(
      classifyHealth({
        ...base,
        createdAt: ago(10),
        memberCount: 1,
        sessionCount: 0,
        activeWeeks: 0,
      }),
    ).toBe("never_activated");
  });

  it("does not call a brand-new empty church never_activated", () => {
    expect(
      classifyHealth({
        ...base,
        createdAt: ago(2),
        memberCount: 0,
        sessionCount: 0,
        activeWeeks: 0,
        lastSeenAt: ago(1),
      }),
    ).toBe("healthy");
  });

  it("at_risk when previously regular but silent 14d+", () => {
    expect(classifyHealth({ ...base, activeWeeks: 5, lastSeenAt: ago(20) })).toBe(
      "at_risk",
    );
  });

  it("only idle at 20d when it was never regular", () => {
    expect(classifyHealth({ ...base, activeWeeks: 1, lastSeenAt: ago(20) })).toBe(
      "idle",
    );
  });

  it("respects the 7/8/30/31 day boundaries", () => {
    const notRegular = { ...base, activeWeeks: 1 };
    expect(classifyHealth({ ...notRegular, lastSeenAt: ago(7) })).toBe("healthy");
    expect(classifyHealth({ ...notRegular, lastSeenAt: ago(8) })).toBe("idle");
    expect(classifyHealth({ ...notRegular, lastSeenAt: ago(30) })).toBe("idle");
    expect(classifyHealth({ ...notRegular, lastSeenAt: ago(31) })).toBe("dormant");
  });

  it("falls back to createdAt when lastSeenAt is null", () => {
    // No activity rows at all means no active weeks either.
    expect(
      classifyHealth({
        ...base,
        lastSeenAt: null,
        createdAt: ago(40),
        memberCount: 5,
        sessionCount: 2,
        activeWeeks: 0,
      }),
    ).toBe("dormant");
  });
});

describe("funnelFor", () => {
  it("counts completed onboarding steps", () => {
    expect(
      funnelFor({
        members: true,
        staff: true,
        attendance: false,
        giving: false,
        message: false,
      }),
    ).toBe(2);
  });

  it("is zero for a church that has done nothing", () => {
    expect(
      funnelFor({
        members: false,
        staff: false,
        attendance: false,
        giving: false,
        message: false,
      }),
    ).toBe(0);
  });
});
