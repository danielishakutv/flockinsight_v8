import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";

describe("normalizeEmail", () => {
  it("rescues the mechanical damage around a good address", () => {
    expect(normalizeEmail("John@Gmail.com.")).toBe("john@gmail.com");
    expect(normalizeEmail("<a@b.co>")).toBe("a@b.co");
    expect(normalizeEmail("  john@gmail.com, ")).toBe("john@gmail.com");
    expect(normalizeEmail("john@gmail.com;")).toBe("john@gmail.com");
    expect(normalizeEmail('"pastor@church.org"')).toBe("pastor@church.org");
    expect(normalizeEmail("mailto:info@church.ng")).toBe("info@church.ng");
  });

  it("refuses what is still malformed underneath", () => {
    for (const bad of [
      "john@gmail..com",
      "john.@gmail.com",
      ".john@gmail.com",
      "john,@gmail.com",
      "john@@gmail.com",
      "john@gmail",
      "john@gmail.c",
      "john@gmail.c0m",
      "john@-gmail.com",
      "john@gmail-.com",
      "jo hn@gmail.com",
      "@gmail.com",
      "john@",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(normalizeEmail(bad as string)).toBeNull();
    }
  });

  it("keeps ordinary valid addresses as they are, lowercased", () => {
    expect(normalizeEmail("a+b@x.co")).toBe("a+b@x.co");
    expect(normalizeEmail("o'brien@example.com")).toBe("o'brien@example.com");
    expect(normalizeEmail("a_b-c.d@sub.domain.ng")).toBe("a_b-c.d@sub.domain.ng");
    expect(normalizeEmail("User@XN--MNCHEN-3YA.DE")).toBe("user@xn--mnchen-3ya.de");
  });

  it("sends an internationalised domain in its ASCII form", () => {
    expect(normalizeEmail("user@münchen.de")).toBe("user@xn--mnchen-3ya.de");
  });

  it("enforces the length limits", () => {
    expect(normalizeEmail(`${"a".repeat(65)}@x.com`)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(64)}@x.com`)).not.toBeNull();
    expect(normalizeEmail(`a@${"b".repeat(250)}.com`)).toBeNull();
  });

  it("isValidEmail agrees with normalizeEmail", () => {
    expect(isValidEmail("john@gmail.com.")).toBe(true);
    expect(isValidEmail("john@gmail..com")).toBe(false);
  });
});
