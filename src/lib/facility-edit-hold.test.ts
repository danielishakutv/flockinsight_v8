import { describe, expect, it } from "vitest";
import { editHold } from "@/lib/facility-shared";

describe("what editing a booking does to its hold on the slot", () => {
  it("re-checks an approved booking whose times move, on a facility without approval", () => {
    expect(editHold({ status: "approved", requiresApproval: false, slotChanged: true })).toBe(
      "hold",
    );
  });

  it("re-checks an approved booking even when only its details change", () => {
    // Still holds the slot, so it is still checked under the facility lock.
    expect(editHold({ status: "approved", requiresApproval: true, slotChanged: false })).toBe(
      "hold",
    );
  });

  it("sends a moved approval back to be approved again where approval is required", () => {
    // The old bug: this skipped the clash check and kept "approved", so moving
    // the youth event onto the wedding's Saturday double-booked the hall.
    expect(editHold({ status: "approved", requiresApproval: true, slotChanged: true })).toBe(
      "rerequest",
    );
  });

  it("leaves a booking that never held the slot as it was", () => {
    for (const status of ["requested", "declined", "cancelled"] as const)
      expect(editHold({ status, requiresApproval: true, slotChanged: true })).toBe("unchanged");
  });
});
