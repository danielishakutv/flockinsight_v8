import { describe, expect, it } from "vitest";
import { emailOutcomesFrom } from "@/lib/comm-outcomes";

const list = [
  { memberId: "m1", name: "Ada", email: "ada@example.com" },
  { memberId: "m2", name: "Bola", email: "bola@example.com" },
  { memberId: null, name: "", email: "typed@example.com" },
];

describe("emailOutcomesFrom", () => {
  it("records a provider refusal as failed - an object is not success", () => {
    const out = emailOutcomesFrom(list, [
      { status: "fulfilled", value: { ok: false, id: null, error: "rate_limit_exceeded" } },
      { status: "fulfilled", value: { ok: true, id: "abc" } },
      { status: "rejected", reason: new Error("SMTP down") },
    ]);
    expect(out.map((o) => o.status)).toEqual(["failed", "sent", "failed"]);
    expect(out[0].error).toBe("rate_limit_exceeded");
    expect(out[1].providerMessageId).toBe("abc");
    expect(out[1].error).toBeNull();
    expect(out[2].error).toBe("SMTP down");
    expect(out[2].memberId).toBeNull();
  });

  it("gives a refusal without a reason a readable one", () => {
    const out = emailOutcomesFrom(list.slice(0, 1), [
      { status: "fulfilled", value: { ok: false, id: null } },
    ]);
    expect(out[0].status).toBe("failed");
    expect(out[0].error).toMatch(/did not accept/);
  });

  it("never counts a missing result as sent", () => {
    const out = emailOutcomesFrom(list.slice(0, 2), [
      { status: "fulfilled", value: { ok: true, id: "x" } },
    ]);
    expect(out[1].status).toBe("failed");
  });
});
