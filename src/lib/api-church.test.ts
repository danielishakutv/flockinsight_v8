import { describe, expect, it } from "vitest";
import { redirectTarget, refusalForRedirect } from "@/lib/api-church";

/** The shape `redirect()` throws in Next 16 (see redirect-error.js). */
const redirectError = (url: string) =>
  Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });

describe("an API answers in JSON where a page would redirect", () => {
  it("reads where a Next redirect was going", () => {
    expect(redirectTarget(redirectError("/login"))).toBe("/login");
    expect(redirectTarget(redirectError("/select-church?next=a;b"))).toBe("/select-church?next=a;b");
  });

  it("is not fooled by an ordinary error", () => {
    expect(redirectTarget(new Error("boom"))).toBeNull();
    expect(redirectTarget({ digest: "DYNAMIC_SERVER_USAGE" })).toBeNull();
    expect(redirectTarget(null)).toBeNull();
  });

  it("tells a signed-out caller to sign in — and nobody else", () => {
    expect(refusalForRedirect("/login")).toMatchObject({ status: 401, code: "signin" });
    // A paused church, or a person who has not picked a church, is not told to
    // sign in: that instruction cannot help them.
    expect(refusalForRedirect("/suspended")).toMatchObject({ status: 403, code: "suspended" });
    expect(refusalForRedirect("/select-church")).toMatchObject({ status: 409, code: "no-church" });
    expect(refusalForRedirect("/onboarding")).toMatchObject({ status: 409, code: "no-church" });
    expect(refusalForRedirect("/try")).toMatchObject({ status: 403, code: "elsewhere" });
  });
});
