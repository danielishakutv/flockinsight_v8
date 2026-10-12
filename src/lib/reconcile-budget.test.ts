import { describe, expect, it } from "vitest";
import { createBudget } from "@/lib/reconcile-budget";

const budget = { deadlineMs: 1000, maxConsecutiveUnknown: 3 };

describe("reconcile budget", () => {
  it("carries on while there is time and Paystack is answering", () => {
    const b = createBudget(0, budget);
    b.record("success");
    b.record("pending");
    expect(b.stopReason(999)).toBeNull();
  });

  it("stops at the deadline", () => {
    const b = createBudget(0, budget);
    expect(b.stopReason(1000)).toBe("deadline");
  });

  it("stops after enough unanswered verifies in a row", () => {
    const b = createBudget(0, budget);
    b.record("unknown");
    b.record("unknown");
    expect(b.stopReason(10)).toBeNull();
    b.record("unknown");
    expect(b.stopReason(10)).toBe("paystack-unresponsive");
  });

  it("forgives scattered failures: any real answer resets the run", () => {
    const b = createBudget(0, budget);
    b.record("unknown");
    b.record("unknown");
    b.record("already");
    b.record("unknown");
    b.record("unknown");
    expect(b.stopReason(10)).toBeNull();
  });
});
