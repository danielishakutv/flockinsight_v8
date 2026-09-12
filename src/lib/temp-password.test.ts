import { describe, expect, it } from "vitest";
import {
  TEMP_PASSWORD_BITS,
  generateTempPassword,
  randomSlugSuffix,
} from "@/lib/temp-password";

describe("generateTempPassword", () => {
  it("carries enough entropy to be worth nothing to an attacker", () => {
    // The version this replaced had ~17 bits: two words from a list of twelve
    // and a three-digit number, about 129,600 possibilities.
    expect(TEMP_PASSWORD_BITS).toBeGreaterThanOrEqual(64);
  });

  it("reads as three groups of five", () => {
    expect(generateTempPassword()).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  });

  it("never uses a character that is ambiguous out loud", () => {
    // I/L/1, O/0 and U are the ones people mishear or mistype.
    const banned = /[ILOU]/;
    for (let i = 0; i < 500; i++) {
      expect(generateTempPassword()).not.toMatch(banned);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateTempPassword());
    expect(seen.size).toBe(1000);
  });

  it("uses most of the alphabet, so no character is quietly unreachable", () => {
    // A modulo-biased or mis-scaled generator usually shows up as a range
    // that never produces its last few symbols.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      for (const c of generateTempPassword().replace(/-/g, "")) seen.add(c);
    }
    expect(seen.size).toBe(32);
  });
});

describe("randomSlugSuffix", () => {
  it("is four lowercase alphanumerics", () => {
    expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
  });

  it("varies", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomSlugSuffix());
    // 36^4 is 1.7m; 200 draws colliding more than a couple of times would
    // mean something is wrong with the source.
    expect(seen.size).toBeGreaterThan(195);
  });
});
