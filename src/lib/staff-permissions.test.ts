import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS } from "./permissions-catalog";
import {
  beyondYourOwnMessage,
  permissionsBeyond,
  resolveStaffAccess,
} from "./staff-permissions";
import { betterAuthRoleFor, orgRoleAfterClearingRole } from "./staff-access";

const basics = [...MEMBER_DEFAULT_PERMISSIONS].sort();
const sorted = (s: Set<string>) => [...s].sort();

describe("resolveStaffAccess", () => {
  it("gives nothing to somebody with no seat", () => {
    const a = resolveStaffAccess(null, null);
    expect(a.isOwner).toBe(false);
    expect(a.perms.size).toBe(0);
  });

  it("gives the owner everything", () => {
    const a = resolveStaffAccess({ role: "owner", roleId: null }, null);
    expect(a.isOwner).toBe(true);
    expect(a.perms.size).toBe(ALL_PERMISSIONS.length);
  });

  it("reads a church role as the whole answer — a stale 'admin' adds nothing", () => {
    // updateRole removed team.manage but the org role was left as "admin".
    const a = resolveStaffAccess(
      { role: "admin", roleId: "r1" },
      { permissions: ["members.view"], isSystem: false },
    );
    expect(sorted(a.perms)).toEqual(["members.view"]);
  });

  it("treats the system role as everything today", () => {
    const a = resolveStaffAccess(
      { role: "member", roleId: "sys" },
      { permissions: ["members.view"], isSystem: true },
    );
    expect(a.perms.size).toBe(ALL_PERMISSIONS.length);
  });

  it("drops a former role-holder to the basics, not to everything", () => {
    // What deleteRole / assignRole(null) now leave behind.
    const a = resolveStaffAccess({ role: "member", roleId: null }, null);
    expect(sorted(a.perms)).toEqual(basics);
    expect(a.perms.has("giving.view")).toBe(false);
  });

  it("reads a role id it cannot resolve as the basics", () => {
    const a = resolveStaffAccess({ role: "admin", roleId: "gone" }, null);
    expect(sorted(a.perms)).toEqual(basics);
  });

  it("keeps a genuine legacy admin (never had a role) fully enabled", () => {
    const a = resolveStaffAccess({ role: "admin", roleId: null }, null);
    expect(a.perms.size).toBe(ALL_PERMISSIONS.length);
  });
});

describe("orgRoleAfterClearingRole", () => {
  it("demotes somebody whose admin came from the role being cleared", () => {
    expect(orgRoleAfterClearingRole("r1", "admin")).toBe("member");
  });
  it("leaves a legacy admin with no role untouched", () => {
    expect(orgRoleAfterClearingRole(null, "admin")).toBe("admin");
  });
  it("never touches the owner", () => {
    expect(orgRoleAfterClearingRole("r1", "owner")).toBe("owner");
  });
});

describe("betterAuthRoleFor", () => {
  it("is admin exactly when the role manages the team", () => {
    expect(betterAuthRoleFor(["members.view", "team.manage"])).toBe("admin");
    expect(betterAuthRoleFor(["members.view"])).toBe("member");
    expect(betterAuthRoleFor([])).toBe("member");
  });
});

describe("permissionsBeyond", () => {
  // The volunteer secretary from the review: the register, and Manage team.
  const secretary = resolveStaffAccess(
    { role: "admin", roleId: "r1" },
    { permissions: ["members.view", "team.manage"], isSystem: false },
  );

  it("refuses what the granter does not hold, so Manage team is not a key to everything", () => {
    expect(permissionsBeyond(secretary, ["members.view", "finance.manage"])).toEqual([
      "finance.manage",
    ]);
    expect(permissionsBeyond(secretary, ALL_PERMISSIONS).length).toBe(ALL_PERMISSIONS.length - 2);
  });

  it("lets them hand on what they do hold", () => {
    expect(permissionsBeyond(secretary, ["members.view", "team.manage"])).toEqual([]);
    expect(permissionsBeyond(secretary, [])).toEqual([]);
  });

  it("never limits the owner", () => {
    const owner = resolveStaffAccess({ role: "owner", roleId: null }, null);
    expect(permissionsBeyond(owner, ALL_PERMISSIONS)).toEqual([]);
  });

  it("names a key once however often it was asked for", () => {
    expect(permissionsBeyond(secretary, ["wallet.x", "wallet.x"])).toEqual(["wallet.x"]);
  });

  it("names what was out of reach the way the roles page does", () => {
    const msg = beyondYourOwnMessage(["finance.manage"]);
    expect(msg).toContain("Finance (Manage)");
    expect(msg).toMatch(/church owner/);
    expect(beyondYourOwnMessage(ALL_PERMISSIONS.slice(0, 5))).toMatch(/and 2 more/);
  });
});
