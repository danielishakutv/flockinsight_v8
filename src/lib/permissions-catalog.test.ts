import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  PERMISSION_CATALOG,
} from "@/lib/permissions-catalog";

/**
 * A role stores a fixed list of permission keys, frozen when it was saved. So
 * every module added afterwards is invisible to anyone on that role until
 * somebody grants it — which is why a church that signed up in June was
 * missing half the app by September.
 *
 * These lock down the parts of that arrangement that must not drift.
 */

/** What a role written before Training and Finance existed would hold. */
const LEGACY_ROLE = [
  "attendance.view", "attendance.manage",
  "giving.view", "giving.manage",
  "members.view", "members.manage",
  "groups.view", "groups.manage",
  "followup.view", "followup.manage",
  "communication.view", "communication.manage",
  "analytics.view",
];

describe("permission catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("every key is namespaced module.action", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(p, `${p} should look like "module.action"`).toMatch(
        /^[a-z]+\.(view|manage)$/,
      );
    }
  });

  it("ALL_PERMISSIONS is exactly the catalogue, flattened", () => {
    const fromCatalogue = PERMISSION_CATALOG.flatMap((m) =>
      m.perms.map((p) => p.key),
    );
    expect(ALL_PERMISSIONS).toEqual(fromCatalogue);
  });

  it("every module a church can open has a permission", () => {
    // If a module ships without one it is either invisible or ungoverned.
    const modules = PERMISSION_CATALOG.map((m) => m.key);
    for (const expected of [
      "attendance", "giving", "finance", "members", "groups",
      "training", "followup", "communication", "analytics",
      "media", "forms", "devotionals", "settings", "team",
    ]) {
      expect(modules, `${expected} should be in the catalogue`).toContain(
        expected,
      );
    }
  });

  it("the member baseline stays view-only", () => {
    // This is what someone with no role assigned gets. It must never include a
    // manage permission, or an unassigned staff member could change records.
    for (const p of MEMBER_DEFAULT_PERMISSIONS) {
      expect(p, `${p} must not be a manage permission`).toMatch(/\.view$/);
      expect(ALL_PERMISSIONS).toContain(p);
    }
  });
});

describe("roles frozen before newer modules", () => {
  it("is missing the modules added since — the bug we were looking at", () => {
    const missing = ALL_PERMISSIONS.filter((p) => !LEGACY_ROLE.includes(p));
    // Not an exact count, which would fail on every new module. The point is
    // that a stale role loses real ground, and that these two are in it.
    expect(missing).toContain("training.view");
    expect(missing).toContain("finance.view");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("names the modules an admin would be shown to grant", () => {
    const missing = new Set(
      ALL_PERMISSIONS.filter((p) => !LEGACY_ROLE.includes(p)),
    );
    const labels = PERMISSION_CATALOG.filter((m) =>
      m.perms.some((p) => missing.has(p.key)),
    ).map((m) => m.label);
    expect(labels).toContain("Training & classes");
    expect(labels).toContain("Finance");
    // Modules the legacy role already fully covers must not be listed.
    expect(labels).not.toContain("Attendance");
    expect(labels).not.toContain("Members");
  });
});
