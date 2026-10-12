import type { SettleResult } from "@/lib/paystack-outcome";

/**
 * When the reconcile run should stop asking Paystack. Pure, so it is tested.
 *
 * The run verifies one reference at a time, and each verify may wait twenty
 * seconds. Six hundred pending rows against a Paystack that has stopped
 * answering is more than three hours — a run still going when the next one
 * starts fifteen minutes later, and then the one after that, each hammering
 * an API that is already struggling. So a run has a deadline, and it stops
 * early when Paystack has said nothing useful several times in a row: the
 * rows left are still pending, and the next run picks them up.
 */
export type ReconcileBudget = {
  /** Wall-clock milliseconds a run may spend verifying. */
  deadlineMs: number;
  /** Consecutive "unknown" answers (no answer at all) before giving up. */
  maxConsecutiveUnknown: number;
};

export const DEFAULT_RECONCILE_BUDGET: ReconcileBudget = {
  // Well inside the fifteen-minute cadence, and inside a proxy's timeout.
  deadlineMs: 4 * 60_000,
  maxConsecutiveUnknown: 5,
};

export type StopReason = "deadline" | "paystack-unresponsive";

export function createBudget(
  startedAt: number,
  budget: ReconcileBudget = DEFAULT_RECONCILE_BUDGET,
) {
  let unknownRun = 0;
  return {
    /** Record one answer. */
    record(result: SettleResult) {
      unknownRun = result === "unknown" ? unknownRun + 1 : 0;
    },
    /** Why to stop before the next verify, or null to carry on. */
    stopReason(now: number): StopReason | null {
      if (unknownRun >= budget.maxConsecutiveUnknown) return "paystack-unresponsive";
      if (now - startedAt >= budget.deadlineMs) return "deadline";
      return null;
    },
  };
}
