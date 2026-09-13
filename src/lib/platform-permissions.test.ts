import { describe, expect, it } from "vitest";
import {
  ALL_PLATFORM_PERMISSIONS,
  ESCALATING_PERMISSIONS,
  PLATFORM_MODULES,
  ROLE_PRESETS,
  isEscalating,
  landingPage,
  visibleNav,
} from "@/lib/platform-permissions";

describe("the catalogue itself", () => {
  it("has no duplicate permission keys", () => {
    expect(new Set(ALL_PLATFORM_PERMISSIONS).size).toBe(
      ALL_PLATFORM_PERMISSIONS.length,
    );
  });

  it("has no duplicate pages", () => {
    const hrefs = PLATFORM_MODULES.flatMap((m) => m.pages.map((p) => p.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gates every page on a permission that exists", () => {
    // A page pointing at a key nobody can hold is a page nobody can reach.
    for (const m of PLATFORM_MODULES) {
      for (const p of m.pages) {
        expect(ALL_PLATFORM_PERMISSIONS).toContain(p.perm);
      }
    }
  });

  it("names every escalating permission as a real one", () => {
    for (const key of ESCALATING_PERMISSIONS) {
      expect(ALL_PLATFORM_PERMISSIONS).toContain(key);
    }
  });

  it("builds every preset out of real permissions", () => {
    for (const preset of ROLE_PRESETS) {
      for (const key of preset.perms) {
        expect(ALL_PLATFORM_PERMISSIONS).toContain(key);
      }
    }
  });

  it("gives every preset somewhere to land", () => {
    // A role that can reach nothing is a role that redirects to /dashboard.
    for (const preset of ROLE_PRESETS) {
      expect(landingPage(preset.perms)).not.toBe("/dashboard");
    }
  });

  it("keeps every permission key under the platform namespace", () => {
    // The church side has its own "finance.view"; these must never collide in
    // a log line or a grep.
    for (const key of ALL_PLATFORM_PERMISSIONS) {
      expect(key.startsWith("platform.")).toBe(true);
    }
  });
});

describe("visibleNav", () => {
  it("shows nothing to someone with no permissions", () => {
    expect(visibleNav([])).toEqual([]);
  });

  it("shows everything to someone with all of them", () => {
    const nav = visibleNav(ALL_PLATFORM_PERMISSIONS);
    expect(nav.length).toBe(PLATFORM_MODULES.length);
  });

  it("drops a group entirely rather than leaving an empty heading", () => {
    // A heading with nothing under it reads as something broken.
    const nav = visibleNav(["platform.overview.view"]);
    expect(nav.map((m) => m.key)).toEqual(["overview"]);
  });

  it("shows only the pages a permission actually unlocks", () => {
    const nav = visibleNav(["platform.churches.view"]);
    expect(nav).toHaveLength(1);
    expect(nav[0].pages.map((p) => p.href)).toEqual([
      "/superadmin/churches",
      "/superadmin/denominations",
    ]);
  });

  it("does not let a manage permission alone unlock the page", () => {
    // churches.manage without churches.view should show no church pages:
    // being able to act on a thing you cannot open is not a useful state.
    expect(visibleNav(["platform.churches.manage"])).toEqual([]);
  });
});

describe("landingPage", () => {
  it("sends a full admin to the dashboard", () => {
    expect(landingPage(ALL_PLATFORM_PERMISSIONS)).toBe("/superadmin");
  });

  it("sends a support agent to the first page they can open", () => {
    expect(landingPage(["platform.support.manage"])).toBe("/superadmin/support");
  });

  it("sends someone with nothing back to their own dashboard", () => {
    // Never to a /superadmin page they cannot open — that is a redirect loop.
    expect(landingPage([])).toBe("/dashboard");
  });
});

describe("isEscalating", () => {
  it("flags the permissions that can widen their own holder's access", () => {
    expect(isEscalating("platform.roles.manage")).toBe(true);
    // Reset an owner's password and you are that owner.
    expect(isEscalating("platform.users.manage")).toBe(true);
    // A restore rewrites every table, roles included.
    expect(isEscalating("platform.backups.manage")).toBe(true);
  });

  it("does not flag ordinary ones", () => {
    expect(isEscalating("platform.overview.view")).toBe(false);
    expect(isEscalating("platform.finance.view")).toBe(false);
  });
});
