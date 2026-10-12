import { describe, expect, it } from "vitest";
import { MAX_SMS_ATTEMPTS, queueVerdict } from "@/lib/sms-queue-rules";

describe("queueVerdict", () => {
  it("puts an everything-refused row back in the queue", () => {
    const v = queueVerdict({
      sent: 0,
      failed: 12,
      recipients: 12,
      attempts: 1,
      firstError: "SMS not sent: Insufficient balance",
    });
    expect(v.status).toBe("queued");
    expect(v.retry).toBe(true);
    expect(v.error).toContain("Insufficient balance");
    expect(v.error).toContain("Nothing was charged");
  });

  it("fails it once the attempts run out", () => {
    const v = queueVerdict({
      sent: 0,
      failed: 12,
      recipients: 12,
      attempts: MAX_SMS_ATTEMPTS,
    });
    expect(v.status).toBe("failed");
    expect(v.retry).toBe(false);
    expect(v.error).toMatch(/refused every message/);
  });

  it("never requeues a partial send - that would text the others twice", () => {
    const v = queueVerdict({
      sent: 9,
      failed: 3,
      recipients: 12,
      attempts: 1,
      firstError: "gateway error 502",
    });
    expect(v.status).toBe("sent");
    expect(v.retry).toBe(false);
    expect(v.error).toContain("3 of 12");
    expect(v.error).toContain("gateway error 502");
  });

  it("marks a clean send sent with no error", () => {
    expect(queueVerdict({ sent: 5, failed: 0, recipients: 5, attempts: 1 })).toEqual({
      status: "sent",
      error: null,
      retry: false,
    });
  });

  it("notes unusable numbers on an otherwise clean send", () => {
    const v = queueVerdict({ sent: 4, failed: 0, recipients: 5, attempts: 1 });
    expect(v.status).toBe("sent");
    expect(v.error).toContain("1 of 5");
  });

  it("fails, without retrying, a row where no number was usable", () => {
    const v = queueVerdict({ sent: 0, failed: 0, recipients: 3, attempts: 1 });
    expect(v.status).toBe("failed");
    expect(v.retry).toBe(false);
  });

  it("never retries a row the gateway may have sent - a timeout is not a refusal", () => {
    // One bulk call to 1,500 numbers that Termii took but answered too late.
    const v = queueVerdict({
      sent: 0,
      failed: 0,
      unconfirmed: 1500,
      recipients: 1500,
      attempts: 1,
      firstError: null,
    });
    expect(v.status).toBe("failed");
    expect(v.retry).toBe(false);
    expect(v.error).toContain("did not confirm 1500 of 1500");
    expect(v.error).toContain("not retried");
  });

  it("does not retry when some calls were refused and others are unconfirmed", () => {
    const v = queueVerdict({
      sent: 0,
      failed: 4,
      unconfirmed: 6,
      recipients: 10,
      attempts: 1,
      firstError: "SMS not sent: Insufficient balance",
    });
    expect(v.retry).toBe(false);
    expect(v.status).toBe("failed");
    expect(v.error).toContain("4 more were refused");
  });

  it("reports unconfirmed messages alongside a partial send", () => {
    const v = queueVerdict({ sent: 5, failed: 0, unconfirmed: 3, recipients: 8, attempts: 1 });
    expect(v.status).toBe("sent");
    expect(v.retry).toBe(false);
    expect(v.error).toContain("did not confirm 3 of 8");
    expect(v.error).not.toContain("could not be sent");
  });
});
