import { describe, expect, it } from "vitest";
import {
  adminAccountRefusal,
  exceedsCaller,
  grantRefusal,
  saveRoleRefusal,
  targetRefusal,
  type PlatformCaller,
} from "@/lib/platform-grant-policy";

const FULL: PlatformCaller = {
  id: "full",
  unrestricted: true,
  roleId: null,
  perms: new Set(["platform.roles.manage", "platform.users.manage", "platform.finance.view"]),
};

const SCOPED: PlatformCaller = {
  id: "scoped",
  unrestricted: false,
  roleId: "role-support",
  perms: new Set(["platform.roles.manage", "platform.users.manage", "platform.support.view"]),
};

describe("exceedsCaller", () => {
  it("never for an unrestricted admin", () => {
    expect(exceedsCaller(FULL, null)).toBe(false);
    expect(exceedsCaller(FULL, ["anything.at.all"])).toBe(false);
  });
  it("full access always exceeds a scoped admin", () => {
    expect(exceedsCaller(SCOPED, null)).toBe(true);
  });
  it("a subset does not; one extra permission does", () => {
    expect(exceedsCaller(SCOPED, ["platform.support.view"])).toBe(false);
    expect(exceedsCaller(SCOPED, [])).toBe(false);
    expect(exceedsCaller(SCOPED, ["platform.support.view", "platform.finance.view"])).toBe(true);
  });
});

describe("addAdmin / assignRole: what may be handed out", () => {
  it("a scoped admin cannot grant full access", () => {
    expect(grantRefusal(SCOPED, null)).toMatch(/full-access admin/);
  });
  it("a scoped admin cannot grant a role reaching past their own", () => {
    expect(grantRefusal(SCOPED, ["platform.finance.view"])).toMatch(/don't have yourself/);
  });
  it("a scoped admin can grant within their reach", () => {
    expect(grantRefusal(SCOPED, ["platform.support.view"])).toBeNull();
  });
  it("an unrestricted admin can grant anything", () => {
    expect(grantRefusal(FULL, null)).toBeNull();
    expect(grantRefusal(FULL, ["platform.finance.view"])).toBeNull();
  });
});

describe("assignRole / removeAdmin: who may be changed", () => {
  it("a scoped admin cannot touch a full-access admin", () => {
    expect(
      targetRefusal(SCOPED, { id: "other", isSuperAdmin: true, permissions: null }),
    ).toMatch(/full-access admin/);
  });
  it("a scoped admin cannot move or remove an admin who can do more", () => {
    expect(
      targetRefusal(SCOPED, {
        id: "other",
        isSuperAdmin: true,
        permissions: ["platform.finance.view"],
      }),
    ).toMatch(/can do things you can't/);
  });
  it("a scoped admin can manage an admin within their reach", () => {
    expect(
      targetRefusal(SCOPED, {
        id: "other",
        isSuperAdmin: true,
        permissions: ["platform.support.view"],
      }),
    ).toBeNull();
  });
  it("an unrestricted admin can change anyone", () => {
    expect(
      targetRefusal(FULL, { id: "other", isSuperAdmin: true, permissions: null }),
    ).toBeNull();
  });
});

describe("saveRole: a scoped admin cannot widen their way to full powers", () => {
  it("refuses editing the role they are on, even to add nothing new", () => {
    expect(
      saveRoleRefusal(SCOPED, {
        id: "role-support",
        permissions: ["platform.support.view"],
        existing: ["platform.support.view"],
      }),
    ).toMatch(/role you're on/);
  });
  it("refuses giving any role a permission they lack", () => {
    expect(
      saveRoleRefusal(SCOPED, { permissions: ["platform.finance.view"] }),
    ).toMatch(/permissions you have yourself/);
    expect(
      saveRoleRefusal(SCOPED, {
        id: "role-other",
        permissions: ["platform.support.view", "platform.finance.view"],
        existing: ["platform.support.view"],
      }),
    ).toMatch(/permissions you have yourself/);
  });
  it("refuses narrowing a role that reaches further than they do", () => {
    expect(
      saveRoleRefusal(SCOPED, {
        id: "role-finance",
        permissions: [],
        existing: ["platform.finance.view"],
      }),
    ).toMatch(/can do things you can't/);
  });
  it("allows a role within their reach", () => {
    expect(
      saveRoleRefusal(SCOPED, {
        id: "role-other",
        permissions: ["platform.support.view"],
        existing: [],
      }),
    ).toBeNull();
  });
  it("an unrestricted admin can edit any role, their own included", () => {
    expect(
      saveRoleRefusal({ ...FULL, roleId: null }, {
        id: "role-any",
        permissions: ["anything"],
        existing: ["else"],
      }),
    ).toBeNull();
  });
});

describe("guardAdminTarget: account edits on another admin", () => {
  it("refuses a scoped admin editing any other admin, even a narrower one", () => {
    expect(adminAccountRefusal(SCOPED, { id: "other", isSuperAdmin: true })).toMatch(
      /another admin's account/,
    );
  });
  it("allows ordinary accounts and their own", () => {
    expect(adminAccountRefusal(SCOPED, { id: "user", isSuperAdmin: false })).toBeNull();
    expect(adminAccountRefusal(SCOPED, { id: "scoped", isSuperAdmin: true })).toBeNull();
    expect(adminAccountRefusal(SCOPED, null)).toBeNull();
  });
  it("an unrestricted admin may edit another admin", () => {
    expect(adminAccountRefusal(FULL, { id: "other", isSuperAdmin: true })).toBeNull();
  });
});
