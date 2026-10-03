import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/*
 * The module reads PAYMENTS_ENC_KEY at call time, not at import time, which is
 * what lets these tests change it. That is deliberate in the module too: PM2
 * has handed this app a stale environment before (see the SMS sender ID), and
 * a value read once at import cannot be corrected by a restart that reloads
 * .env but not the module graph.
 */
async function load() {
  return import("./secret-box");
}

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.PAYMENTS_ENC_KEY;
  process.env.PAYMENTS_ENC_KEY = KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env.PAYMENTS_ENC_KEY;
  else process.env.PAYMENTS_ENC_KEY = saved;
});

describe("sealSecret / openSecret", () => {
  it("round-trips a secret", async () => {
    const { sealSecret, openSecret } = await load();
    const res = sealSecret("sk_live_abc123");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sealed).not.toContain("sk_live");
    expect(openSecret(res.sealed)).toBe("sk_live_abc123");
  });

  it("produces a different ciphertext every time", async () => {
    const { sealSecret } = await load();
    const a = sealSecret("same-secret");
    const b = sealSecret("same-secret");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // A fixed IV would make identical keys look identical in the database,
    // which tells an attacker which churches share a gateway account.
    expect(a.sealed).not.toBe(b.sealed);
  });

  it("refuses to decrypt with a different key", async () => {
    const { sealSecret, openSecret } = await load();
    const res = sealSecret("sk_live_abc123");
    if (!res.ok) throw new Error("seal failed");
    process.env.PAYMENTS_ENC_KEY = OTHER_KEY;
    expect(openSecret(res.sealed)).toBeNull();
  });

  /*
   * The reason for GCM rather than CBC. A changed byte in the database must
   * fail, not decrypt into a different key that then gets sent to a gateway.
   */
  it("detects tampering", async () => {
    const { sealSecret, openSecret } = await load();
    const res = sealSecret("sk_live_abc123");
    if (!res.ok) throw new Error("seal failed");
    const parts = res.sealed.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64url");
    expect(openSecret(parts.join("."))).toBeNull();
  });

  it("rejects a mangled or empty value instead of throwing", async () => {
    const { openSecret } = await load();
    expect(openSecret(null)).toBeNull();
    expect(openSecret("")).toBeNull();
    expect(openSecret("not-sealed")).toBeNull();
    expect(openSecret("v1.aaa.bbb")).toBeNull();
    expect(openSecret("v2.aaa.bbb.ccc")).toBeNull();
  });

  it("says it is not ready when the key is missing or the wrong size", async () => {
    const { isSecretBoxReady, sealSecret } = await load();
    delete process.env.PAYMENTS_ENC_KEY;
    expect(isSecretBoxReady()).toBe(false);
    expect(sealSecret("x").ok).toBe(false);

    // 16 bytes is valid AES but not what this module promises; a short paste
    // is the usual cause, and accepting it would weaken every stored key.
    process.env.PAYMENTS_ENC_KEY = randomBytes(16).toString("base64");
    expect(isSecretBoxReady()).toBe(false);
  });
});

describe("sealJson / openJson", () => {
  it("round-trips a flat string map", async () => {
    const { sealJson, openJson } = await load();
    const res = sealJson({ contractCode: "123456", secretHash: "abc" });
    if (!res.ok) throw new Error("seal failed");
    expect(openJson(res.sealed)).toEqual({
      contractCode: "123456",
      secretHash: "abc",
    });
  });

  it("returns an empty object for anything unreadable", async () => {
    const { openJson } = await load();
    expect(openJson(null)).toEqual({});
    expect(openJson("rubbish")).toEqual({});
  });
});

describe("secretHint", () => {
  it("shows the last four characters, never the first", async () => {
    const { secretHint } = await load();
    // Every Paystack secret starts "sk_live_", so a prefix identifies nothing.
    expect(secretHint("sk_live_0123456789wxyz")).toBe("••••wxyz");
    expect(secretHint("abc")).toBeNull();
    expect(secretHint(null)).toBeNull();
  });
});

describe("safeCompare", () => {
  it("matches equal strings and rejects everything else", async () => {
    const { safeCompare } = await load();
    expect(safeCompare("abc123", "abc123")).toBe(true);
    expect(safeCompare("abc123", "abc124")).toBe(false);
    expect(safeCompare("abc", "abcd")).toBe(false);
    expect(safeCompare("", "")).toBe(true);
  });
});
