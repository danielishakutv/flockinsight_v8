import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps a same-site path, with its query and hash", () => {
    expect(safeRedirectPath("/accept-invitation/abc")).toBe("/accept-invitation/abc");
    expect(safeRedirectPath("/members?status=active#top")).toBe(
      "/members?status=active#top",
    );
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("refuses another site, however it is spelled", () => {
    for (const bad of [
      "https://evil.com",
      "http://evil.com/expired",
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\\\evil.com",
      "/x\\..\\..\\/evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "javascript:alert(1)",
      "evil.com",
      " /dashboard",
    ]) {
      expect(safeRedirectPath(bad), bad).toBeNull();
    }
  });

  it("leaves an encoded slash as a path on this site", () => {
    // "/%2F%2Fevil.com" is a path segment, not a host; the browser keeps it here.
    expect(safeRedirectPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });

  it("treats nothing as nothing", () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath("")).toBeNull();
  });
});
