import { describe, expect, it } from "vitest";
import { normaliseCode, referralCode, referralUrl } from "@/lib/referral";

describe("referralCode", () => {
  it("prefers the public handle, which is what people already see", () => {
    expect(referralCode({ handle: "grace-chapel", slug: "grace-chapel-2" })).toBe(
      "grace-chapel",
    );
  });

  it("falls back to the slug when there is no handle", () => {
    expect(referralCode({ handle: null, slug: "grace-chapel-2" })).toBe(
      "grace-chapel-2",
    );
  });

  it("ignores a handle that is only whitespace", () => {
    expect(referralCode({ handle: "   ", slug: "fallback" })).toBe("fallback");
  });
});

describe("referralUrl", () => {
  it("points at the /r/ route that can set the cookie", () => {
    const url = referralUrl({ handle: "grace-chapel", slug: "x" });
    expect(url).toMatch(/\/r\/grace-chapel$/);
  });

  it("escapes a code that would otherwise break the path", () => {
    const url = referralUrl({ handle: "a/b?c", slug: "x" });
    expect(url).not.toContain("a/b?c");
    expect(url).toContain("a%2Fb%3Fc");
  });
});

describe("normaliseCode", () => {
  it("accepts a handle however it was typed off a printed page", () => {
    expect(normaliseCode("  Grace-Chapel  ")).toBe("grace-chapel");
    expect(normaliseCode("GRACE-CHAPEL")).toBe("grace-chapel");
  });

  it("rejects anything that is not a handle we could have issued", () => {
    // These are the shapes an attacker would try, and none is a valid slug.
    expect(normaliseCode("../admin")).toBeNull();
    expect(normaliseCode("a b")).toBeNull();
    expect(normaliseCode("<script>")).toBeNull();
    expect(normaliseCode("-leading-dash")).toBeNull();
    expect(normaliseCode("x")).toBeNull(); // too short
    expect(normaliseCode("")).toBeNull();
    expect(normaliseCode(null)).toBeNull();
    expect(normaliseCode(undefined)).toBeNull();
  });

  it("rejects a code longer than any handle we issue", () => {
    expect(normaliseCode("a".repeat(200))).toBeNull();
  });

  it("accepts digits, which slugs can contain", () => {
    expect(normaliseCode("grace-chapel-2")).toBe("grace-chapel-2");
  });
});
