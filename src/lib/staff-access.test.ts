import { describe, expect, it } from "vitest";
import { betterAuthRoleFor } from "@/lib/staff-access";
// permissions-catalog, not permissions: the latter is server-only and would
// break the test run.
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
} from "@/lib/permissions-catalog";

describe("betterAuthRoleFor", () => {
  it("grants admin when the role can manage the team", () => {
    expect(betterAuthRoleFor(["members.view", "team.manage"])).toBe("admin");
  });

  it("is a plain member without team.manage", () => {
    expect(betterAuthRoleFor(["members.view", "giving.manage"])).toBe("member");
  });

  it("is a plain member for an empty permission list", () => {
    expect(betterAuthRoleFor([])).toBe("member");
  });

  it("does not match a permission that merely starts with team.", () => {
    expect(betterAuthRoleFor(["team.view"])).toBe("member");
  });
});

/**
 * These are the exact permission sets ensureDefaultRoles seeds every church's
 * "Admin" and "Member" roles with, so they are what this derivation actually
 * runs on in production. They also fail loudly if team.manage is ever dropped
 * from ALL_PERMISSIONS.
 */
describe("betterAuthRoleFor with the seeded church roles", () => {
  it("makes the seeded Admin role an org admin, so it can invite", () => {
    expect(betterAuthRoleFor(ALL_PERMISSIONS)).toBe("admin");
  });

  it("leaves the seeded Member role an org member", () => {
    expect(betterAuthRoleFor(MEMBER_DEFAULT_PERMISSIONS)).toBe("member");
  });
});
