import { describe, expect, it } from "vitest";
import {
  callbackStatus,
  classifyCharge,
  referenceKind,
  toKobo,
  type VerifyAnswer,
} from "@/lib/paystack-outcome";

/**
 * The rule that decides whether money is credited. The bug it replaced:
 * "anything that is not success is failed", which failed every bank transfer
 * still in flight and every verify that timed out — and nothing ever looked
 * at a failed row again.
 */

const paid = (amountKobo: number, currency = "NGN", status = "success"): VerifyAnswer => ({
  ok: true,
  status,
  amountKobo,
  currency,
});

describe("classifyCharge", () => {
  it("honours a full payment in naira", () => {
    expect(classifyCharge(paid(500_000), 5000)).toBe("success");
  });

  it("honours an overpayment (the money is ours either way)", () => {
    expect(classifyCharge(paid(500_100), 5000)).toBe("success");
  });

  it("refuses a short payment — one kobo short is short", () => {
    expect(classifyCharge(paid(499_999), 5000)).toBe("mismatch");
  });

  it("refuses a payment in another currency, whatever the number", () => {
    expect(classifyCharge(paid(500_000, "USD"), 5000)).toBe("mismatch");
    expect(classifyCharge(paid(500_000, "ngn"), 5000)).toBe("success");
  });

  it("compares in kobo, so a fractional naira amount is not rounded away", () => {
    expect(toKobo(1000.5)).toBe(100_050);
    expect(classifyCharge(paid(100_050), 1000.5)).toBe("success");
    expect(classifyCharge(paid(100_049), 1000.5)).toBe("mismatch");
  });

  it("fails only on a definite answer", () => {
    for (const s of ["failed", "reversed", "abandoned", "FAILED"])
      expect(classifyCharge(paid(0, "NGN", s), 5000)).toBe("failed");
  });

  it("leaves a transfer still in flight pending, never failed", () => {
    for (const s of ["ongoing", "pending", "processing", "queued", "send_otp", ""])
      expect(classifyCharge(paid(0, "NGN", s), 5000)).toBe("pending");
  });

  it("treats no answer as no information", () => {
    expect(classifyCharge({ ok: false, error: "timeout" }, 5000)).toBe("unknown");
  });
});

describe("callbackStatus", () => {
  it("never tells a payer 'failed' for money that may still arrive", () => {
    expect(callbackStatus("pending")).toBe("pending");
    expect(callbackStatus("unknown")).toBe("pending");
    expect(callbackStatus("mismatch")).toBe("pending");
  });

  it("reports a replayed success as success", () => {
    expect(callbackStatus("success")).toBe("success");
    expect(callbackStatus("already")).toBe("success");
    expect(callbackStatus("failed")).toBe("failed");
    expect(callbackStatus("not-found")).toBe("error");
  });
});

describe("referenceKind", () => {
  it("routes each platform product, and nothing else", () => {
    expect(referenceKind("FI-abcd1234-pro-1760000000000")).toBe("subscription");
    expect(referenceKind("WAL-abcd1234-1760000000000")).toBe("wallet");
    expect(referenceKind("SMS-abcd1234-1760000000000")).toBe("sms");
    // A ₦0 activation and a manual record are never settled through Paystack.
    expect(referenceKind("FREE-abcd1234-1760000000000")).toBeNull();
    expect(referenceKind("MANUAL-abcd1234-1760000000000")).toBeNull();
    expect(referenceKind("GIVE-xyz")).toBeNull();
  });
});
