import { describe, expect, it } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_SPECS,
  providerName,
  supportsCurrency,
} from "./specs";

describe("provider specs", () => {
  it("has a spec for every id, and no stray ones", () => {
    expect(Object.keys(PROVIDER_SPECS).sort()).toEqual([...PROVIDER_IDS].sort());
    for (const id of PROVIDER_IDS) expect(PROVIDER_SPECS[id].id).toBe(id);
  });

  /*
   * The settings form renders these fields and the server validates against
   * the same list. A field with no key, or a required one with no label, is a
   * credential a church cannot be asked for properly.
   */
  it("describes every field well enough to render and validate it", () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(spec.fields.length).toBeGreaterThan(0);
      for (const f of spec.fields) {
        expect(f.key).toMatch(/^[a-zA-Z]+$/);
        expect(f.label.length).toBeGreaterThan(2);
      }
    }
  });

  it("marks every money-moving field as a secret", () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      const secret = spec.fields.find((f) => f.key === "secret");
      // If a provider has a secret key field at all, it must be sealed — an
      // unsealed one would be rendered as plain text and stored in the clear.
      if (secret) expect(secret.secret).toBe(true);
    }
  });

  it("knows that a plain link reports nothing back", () => {
    expect(PROVIDER_SPECS.link.reportsBack).toBe(false);
    expect(PROVIDER_SPECS.link.canVerify).toBe(false);
    // And that the real gateways do, since that is what the webhook UI and
    // the settle path both key off.
    for (const id of ["paystack", "flutterwave", "monnify"] as const) {
      expect(PROVIDER_SPECS[id].reportsBack).toBe(true);
      expect(PROVIDER_SPECS[id].canVerify).toBe(true);
    }
  });
});

describe("supportsCurrency", () => {
  it("keeps a naira-only gateway away from other currencies", () => {
    // The actual case this exists for: Monnify is Nigeria-only, and a church
    // in Accra should hear that from us, not from a failed payment.
    expect(supportsCurrency("monnify", "NGN")).toBe(true);
    expect(supportsCurrency("monnify", "GHS")).toBe(false);
  });

  it("ignores case", () => {
    expect(supportsCurrency("paystack", "ngn")).toBe(true);
    expect(supportsCurrency("paystack", "NGN")).toBe(true);
  });

  it("allows anything for a provider with no declared list", () => {
    // "link" is somebody else's page; what it charges in is not ours to know.
    expect(supportsCurrency("link", "XOF")).toBe(true);
  });

  it("refuses a currency a real gateway does not list", () => {
    expect(supportsCurrency("paystack", "XOF")).toBe(false);
  });
});

describe("providerName", () => {
  it("names what it knows and echoes what it does not", () => {
    expect(providerName("paystack")).toBe("Paystack");
    expect(providerName("nonsense")).toBe("nonsense");
  });
});
