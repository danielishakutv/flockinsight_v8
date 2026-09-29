import { describe, expect, it } from "vitest";
import { firstGap } from "@/lib/activation";
import { FUNNEL_STEPS, type FunnelFlags } from "@/lib/health-rules";

const flags = (done: Partial<FunnelFlags>): FunnelFlags => ({
  members: false,
  staff: false,
  attendance: false,
  giving: false,
  message: false,
  ...done,
});

describe("firstGap", () => {
  it("names the earliest missing step, not the furthest reached", () => {
    // A church with giving but no members is blocked on members. Pointing it
    // at the next empty step would suggest a fix it cannot apply yet.
    expect(firstGap(flags({ giving: true }))).toBe("members");
  });

  it("walks forward as a church completes each step", () => {
    expect(firstGap(flags({}))).toBe("members");
    expect(firstGap(flags({ members: true }))).toBe("staff");
    expect(firstGap(flags({ members: true, staff: true }))).toBe("attendance");
  });

  it("returns null once nothing is missing", () => {
    const all = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, true])) as FunnelFlags;
    expect(firstGap(all)).toBeNull();
  });
});
