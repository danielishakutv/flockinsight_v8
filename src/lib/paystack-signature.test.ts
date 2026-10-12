import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The platform webhook's only defence: an HMAC-SHA512 of the RAW body with
 * the secret key. Anybody can POST to the URL; only Paystack can sign.
 */

const SECRET = "sk_test_zzcheck_signature";
process.env.PAYSTACK_SECRET_KEY = SECRET;
const { paystackSignatureValid } = await import("@/lib/paystack");

const body = JSON.stringify({ event: "charge.success", data: { reference: "WAL-abcd1234-1" } });
const sign = (raw: string, key = SECRET) => createHmac("sha512", key).update(raw).digest("hex");

describe("paystackSignatureValid", () => {
  it("accepts Paystack's signature over the exact bytes", () => {
    expect(paystackSignatureValid(body, sign(body))).toBe(true);
  });

  it("refuses a body that was changed after signing", () => {
    const tampered = body.replace("WAL-abcd1234-1", "WAL-abcd1234-2");
    expect(paystackSignatureValid(tampered, sign(body))).toBe(false);
  });

  it("refuses a body re-serialised with different whitespace", () => {
    // Parse-then-stringify is a different body; the route signs request.text().
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(paystackSignatureValid(pretty, sign(body))).toBe(false);
  });

  it("refuses a signature made with another key (a church's giving key, say)", () => {
    expect(paystackSignatureValid(body, sign(body, "sk_live_some_church"))).toBe(false);
  });

  it("refuses a missing or malformed signature without throwing", () => {
    expect(paystackSignatureValid(body, null)).toBe(false);
    expect(paystackSignatureValid(body, "")).toBe(false);
    expect(paystackSignatureValid(body, "abc")).toBe(false);
  });
});
