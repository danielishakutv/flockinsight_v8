import { describe, expect, it } from "vitest";
import { classifyReply, classifySendThrow } from "@/lib/sms-gateway-outcome";

const named = (name: string) => Object.assign(new Error(name), { name });
const fetchFailed = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("classifySendThrow", () => {
  it("calls a timeout uncertain - the gateway may have taken it", () => {
    const v = classifySendThrow(named("TimeoutError"), 30);
    expect(v.uncertain).toBe(true);
    expect(v.error).toContain("30 seconds");
    expect(v.error).toContain("not refunded");
    expect(classifySendThrow(named("AbortError"), 30).uncertain).toBe(true);
  });

  it("calls a reset mid-request uncertain", () => {
    expect(classifySendThrow(fetchFailed("ECONNRESET"), 30).uncertain).toBe(true);
    expect(classifySendThrow(fetchFailed("UND_ERR_SOCKET"), 30).uncertain).toBe(true);
  });

  it("calls a connection that never opened a definite failure", () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]) {
      const v = classifySendThrow(fetchFailed(code), 30);
      expect(v.uncertain).toBe(false);
      expect(v.error).toBe("Could not reach the SMS gateway.");
    }
  });
});

describe("classifyReply", () => {
  it("calls a 2xx whose body could not be read uncertain", () => {
    const v = classifyReply(200, null);
    expect(v.uncertain).toBe(true);
    expect(v.error).toContain("accepted this (200)");
  });

  it("calls a refusal a definite failure, in the gateway's words", () => {
    expect(classifyReply(400, { message: "Insufficient balance" })).toEqual({
      error: "SMS not sent: Insufficient balance",
      uncertain: false,
    });
  });

  it("calls an unreadable error reply a definite failure", () => {
    expect(classifyReply(502, null)).toEqual({
      error: "SMS not sent: gateway error 502",
      uncertain: false,
    });
  });
});
