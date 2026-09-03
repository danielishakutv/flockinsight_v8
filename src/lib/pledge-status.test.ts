import { describe, expect, it } from "vitest";
import {
  isPledgeCovered,
  nextPledgeStatus,
  outstandingOn,
} from "@/lib/pledge-status";

describe("isPledgeCovered", () => {
  it("is true once payments reach the pledged amount", () => {
    expect(isPledgeCovered(50000, 50000)).toBe(true);
    expect(isPledgeCovered(50000, 60000)).toBe(true);
  });

  it("is false while anything is still owed", () => {
    expect(isPledgeCovered(50000, 49999)).toBe(false);
    expect(isPledgeCovered(50000, 0)).toBe(false);
  });

  it("forgives float drift from summing instalments", () => {
    // Three payments of 333.40 against a 1,000.20 pledge really do sum to
    // 1000.1999999999999 in JavaScript. Without the tolerance the pledge would
    // read as a tenth of a picokobo short and never close.
    const paid = [333.4, 333.4, 333.4].reduce((a, b) => a + b, 0);
    expect(paid).toBeLessThan(1000.2); // the drift is real
    expect(isPledgeCovered(1000.2, paid)).toBe(true); // but it is not a shortfall
  });
});

describe("nextPledgeStatus", () => {
  it("completes an active pledge once it is covered", () => {
    expect(nextPledgeStatus("active", 50000, 50000)).toBe("completed");
  });

  it("reopens a completed pledge when a payment is removed or reduced", () => {
    // Regression: deleting or editing down a payment used to leave the pledge
    // marked complete for ever, so it vanished from the outstanding report.
    expect(nextPledgeStatus("completed", 50000, 30000)).toBe("active");
  });

  it("says nothing when the status already matches", () => {
    expect(nextPledgeStatus("active", 50000, 30000)).toBeNull();
    expect(nextPledgeStatus("completed", 50000, 50000)).toBeNull();
  });

  it("never touches a cancelled pledge", () => {
    // Someone cancelled this on purpose; payments must not revive it.
    expect(nextPledgeStatus("cancelled", 50000, 50000)).toBeNull();
    expect(nextPledgeStatus("cancelled", 50000, 0)).toBeNull();
  });
});

describe("outstandingOn", () => {
  it("reports what is genuinely still owed", () => {
    expect(outstandingOn(50000, 30000)).toBe(20000);
    expect(outstandingOn(1000.5, 250.25)).toBe(750.25);
  });

  it("settles a pledge that float drift left a sliver short", () => {
    // Regression: this residue is > 0, so the pledge stayed on the outstanding
    // report for ever and the reminder cron kept texting a member who had
    // finished paying — "0.00 outstanding" — at the church's expense.
    const paid = [333.4, 333.4, 333.4].reduce((a, b) => a + b, 0);
    expect(1000.2 - paid).toBeGreaterThan(0); // the naive sum still owes
    expect(outstandingOn(1000.2, paid)).toBe(0); // this does not
  });

  it("never reports a negative balance when someone overpays", () => {
    expect(outstandingOn(50000, 60000)).toBe(0);
  });
});
