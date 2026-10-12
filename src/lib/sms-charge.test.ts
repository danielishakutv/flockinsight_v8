import { describe, expect, it } from "vitest";
import { batchCost, settleBatch, smsCost } from "@/lib/sms-charge";

describe("smsCost / batchCost", () => {
  it("prices by pages, so a Unicode message costs its real page count", () => {
    expect(smsCost("Hello", 10, 4)).toBe(40);
    // 80 characters with a ₦ is two UCS-2 pages, not one GSM page.
    const naira = "₦" + "a".repeat(79);
    expect(smsCost(naira, 10, 4)).toBe(80);
  });

  it("adds personalised messages one by one", () => {
    expect(batchCost(["Hi Ada", "Hi Bola", "a".repeat(161)], 4)).toBe(16);
  });

  it("rounds to the kobo", () => {
    expect(batchCost(["a", "b", "c"], 1.111)).toBe(3.33);
  });
});

describe("settleBatch", () => {
  it("charges what went and refunds the rest of the hold", () => {
    const held = batchCost(["Hi Ada", "Hi Bola", "Hi Chi"], 4); // 12
    const res = settleBatch(
      held,
      [
        { ok: true, count: 1, pages: 1 },
        { ok: false, count: 1, pages: 1 },
        { ok: true, count: 1, pages: 1 },
      ],
      4,
    );
    expect(res).toEqual({ sent: 2, failed: 1, unconfirmed: 0, pages: 2, spent: 8, refund: 4 });
  });

  it("refunds everything when the gateway refused everything", () => {
    const res = settleBatch(20, [{ ok: false, count: 5, pages: 1 }], 4);
    expect(res.spent).toBe(0);
    expect(res.refund).toBe(20);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(5);
  });

  it("never refunds a negative amount or charges more than was held", () => {
    const res = settleBatch(9.99, [{ ok: true, count: 1, pages: 1 }], 10);
    expect(res.spent).toBe(9.99);
    expect(res.refund).toBe(0);
  });

  it("charges nothing and refunds nothing for a free send", () => {
    expect(settleBatch(0, [{ ok: true, count: 3, pages: 2 }], 0)).toEqual({
      sent: 3,
      failed: 0,
      unconfirmed: 0,
      pages: 6,
      spent: 0,
      refund: 0,
    });
  });

  it("keeps the charge for a group the gateway may have sent - a timeout is not a refusal", () => {
    // Three groups of one page each at 4: one sent, one timed out, one refused.
    const res = settleBatch(
      12,
      [
        { ok: true, count: 1, pages: 1 },
        { ok: false, uncertain: true, count: 1, pages: 1 },
        { ok: false, count: 1, pages: 1 },
      ],
      4,
    );
    expect(res).toEqual({ sent: 1, failed: 1, unconfirmed: 1, pages: 2, spent: 8, refund: 4 });
  });
});
