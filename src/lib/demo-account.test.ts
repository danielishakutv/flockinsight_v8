import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_LOCKED_AUTH_PATHS,
  isDemoLockedAuthPath,
  isSharedDemoAccount,
} from "./demo-account";

/**
 * The shared demo login's password is printed on the sign-in page. One visitor
 * changing it, or moving its email, locked every later prospect out of the
 * demo until somebody repaired it by hand.
 */

describe("isSharedDemoAccount", () => {
  it("is the login whose every seat is in the demo church", () => {
    expect(isSharedDemoAccount([{ isDemo: true }], false)).toBe(true);
  });

  it("leaves a real person who also has a demo seat in charge of their own account", () => {
    expect(isSharedDemoAccount([{ isDemo: true }, { isDemo: false }], false)).toBe(false);
  });

  it("never locks a superadmin, or somebody with no seat at all", () => {
    expect(isSharedDemoAccount([{ isDemo: true }], true)).toBe(false);
    expect(isSharedDemoAccount([], false)).toBe(false);
  });
});

describe("isDemoLockedAuthPath", () => {
  it("covers changing the password, the email, the profile, and deleting the account", () => {
    expect(isDemoLockedAuthPath("/change-password")).toBe(true);
    expect(isDemoLockedAuthPath("/change-email")).toBe(true);
    expect(isDemoLockedAuthPath("/update-user")).toBe(true);
    expect(isDemoLockedAuthPath("/delete-user")).toBe(true);
  });

  it("leaves signing in and out alone, which every prospect needs", () => {
    expect(isDemoLockedAuthPath("/sign-in/email")).toBe(false);
    expect(isDemoLockedAuthPath("/sign-out")).toBe(false);
    expect(isDemoLockedAuthPath("/get-session")).toBe(false);
    expect(isDemoLockedAuthPath(undefined)).toBe(false);
  });

  /*
   * A path Better Auth renames would silently fall out of the list and the
   * endpoint would be open again. Read the installed library and check every
   * locked path is still one of its routes.
   */
  it("names only paths the installed Better Auth really mounts", () => {
    const dir = path.resolve(
      import.meta.dirname,
      "../../node_modules/better-auth/dist/api/routes",
    );
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    for (const p of DEMO_LOCKED_AUTH_PATHS) {
      expect(source, p).toContain(`createAuthEndpoint("${p}"`);
    }
  });
});
