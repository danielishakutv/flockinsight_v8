import { describe, expect, it } from "vitest";
import { betterAuthRoleFor } from "@/lib/staff-access";

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
