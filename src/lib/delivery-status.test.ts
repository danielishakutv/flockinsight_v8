import { describe, expect, it } from "vitest";
import {
  mapResendEvent,
  mapTermiiStatus,
  shouldApply,
  termiiReason,
} from "@/lib/delivery-status";

describe("mapTermiiStatus", () => {
  it("maps every status Termii documents", () => {
    expect(mapTermiiStatus("DELIVERED")).toBe("delivered");
    expect(mapTermiiStatus("Message Sent")).toBe("sent");
    expect(mapTermiiStatus("Received")).toBe("sent");
    expect(mapTermiiStatus("DND Active on Phone Number")).toBe("undelivered");
    expect(mapTermiiStatus("Rejected")).toBe("undelivered");
    expect(mapTermiiStatus("Expired")).toBe("undelivered");
    expect(mapTermiiStatus("Message Failed")).toBe("undelivered");
  });

  it("is case and whitespace insensitive", () => {
    expect(mapTermiiStatus("  delivered  ")).toBe("delivered");
    expect(mapTermiiStatus("dnd active on phone number")).toBe("undelivered");
  });

  it("ignores an unknown status rather than guessing", () => {
    expect(mapTermiiStatus("Something New")).toBeNull();
    expect(mapTermiiStatus("")).toBeNull();
  });
});

describe("mapResendEvent", () => {
  it("records the delivery outcomes", () => {
    expect(mapResendEvent("email.sent")).toBe("sent");
    expect(mapResendEvent("email.delivered")).toBe("delivered");
    expect(mapResendEvent("email.bounced")).toBe("undelivered");
    expect(mapResendEvent("email.failed")).toBe("undelivered");
    expect(mapResendEvent("email.suppressed")).toBe("undelivered");
  });

  it("ignores behavioural events — delivery only, by decision", () => {
    expect(mapResendEvent("email.opened")).toBeNull();
    expect(mapResendEvent("email.clicked")).toBeNull();
    expect(mapResendEvent("email.complained")).toBeNull();
    expect(mapResendEvent("email.delivery_delayed")).toBeNull();
    expect(mapResendEvent("email.scheduled")).toBeNull();
  });
});

describe("termiiReason", () => {
  it("explains DND in words a church admin can act on", () => {
    expect(termiiReason("DND Active on Phone Number")).toMatch(/DND/i);
  });

  it("has no reason for a successful delivery", () => {
    expect(termiiReason("DELIVERED")).toBeNull();
  });
});

describe("shouldApply", () => {
  it("accepts anything for a row with no status yet", () => {
    expect(shouldApply(null, "delivered")).toBe(true);
  });

  it("does not drag a delivered row back to sent when reports arrive late", () => {
    expect(shouldApply("delivered", "sent")).toBe(false);
    expect(shouldApply("undelivered", "sent")).toBe(false);
  });

  it("lets a delivered message later be reported undelivered", () => {
    expect(shouldApply("delivered", "undelivered")).toBe(true);
  });

  it("upgrades sent to a terminal state", () => {
    expect(shouldApply("sent", "delivered")).toBe(true);
    expect(shouldApply("sent", "undelivered")).toBe(true);
  });

  it("never overwrites a skip or a local failure decided before sending", () => {
    expect(shouldApply("skipped", "delivered")).toBe(false);
    expect(shouldApply("failed", "delivered")).toBe(false);
  });
});
