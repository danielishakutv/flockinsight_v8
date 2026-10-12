import { describe, expect, it } from "vitest";
import { isOptedOut, optOutKey } from "@/lib/devotional-recipients";

describe("devotional opt-outs", () => {
  it("matches however the address was typed on either side", () => {
    const optedOut = new Set([optOutKey("Ada@Example.com")]);
    expect(isOptedOut(optedOut, "ada@example.com")).toBe(true);
    expect(isOptedOut(optedOut, " ADA@example.com.")).toBe(true);
    expect(isOptedOut(optedOut, "bola@example.com")).toBe(false);
  });

  it("still matches an opt-out stored before addresses were validated", () => {
    const optedOut = new Set([optOutKey("not an address")]);
    expect(isOptedOut(optedOut, "Not An Address")).toBe(true);
  });
});
