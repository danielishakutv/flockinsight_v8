import { describe, expect, it } from "vitest";
import { OPTED_OUT, dueStep } from "@/lib/activation-nudges";
import type { ActivationRow } from "@/lib/activation";

/**
 * The guards that stop a church being messaged twice, messaged after it has
 * started, or walked through a sequence that does not match how long it has
 * been waiting. With nine stalled churches, one wrong email is eleven per cent
 * of the people this is meant to win back.
 */

const row = (daysSinceSignup: number): ActivationRow =>
  ({
    churchId: "c1",
    name: "Test Church",
    slug: "test",
    plan: "starter",
    health: "never_activated",
    createdAt: new Date(),
    daysSinceSignup,
    lastSeenAt: null,
    memberCount: 1,
    funnel: {
      members: false,
      staff: false,
      attendance: false,
      giving: false,
      message: false,
    },
    funnelCompleted: 0,
    stalledAt: "members",
    stalledLabel: "No members yet",
    stalledDetail: "",
  }) satisfies ActivationRow;

describe("dueStep", () => {
  it("sends nothing in the first days after signup", () => {
    expect(dueStep(row(1), 0)).toBeNull();
    expect(dueStep(row(2), 0)).toBeNull();
  });

  it("opens the sequence once the church has been quiet three days", () => {
    expect(dueStep(row(3), 0)?.stage).toBe(1);
  });

  it("never repeats a step already sent", () => {
    // The stage column only moves forward. This is the guard that stops a
    // daily cron sending step one every morning.
    expect(dueStep(row(5), 1)).toBeNull();
    expect(dueStep(row(12), 2)).toBeNull();
  });

  it("moves on when the next step falls due", () => {
    expect(dueStep(row(10), 1)?.stage).toBe(2);
    expect(dueStep(row(24), 2)?.stage).toBe(3);
  });

  it("jumps a church found late straight to the right step", () => {
    // Otherwise a church discovered after a month is told it signed up a few
    // days ago, then told the same thing again a week later.
    expect(dueStep(row(60), 0)?.stage).toBe(3);
  });

  it("stops after the last step", () => {
    expect(dueStep(row(200), 3)).toBeNull();
  });

  it("never messages a church that was opted out", () => {
    expect(dueStep(row(200), OPTED_OUT)).toBeNull();
    expect(dueStep(row(3), OPTED_OUT)).toBeNull();
  });
});
