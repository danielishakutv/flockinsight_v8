import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEVER_PATHS,
  TEAM_PATHS,
  UNLIMITED_PLAN_INVITATION_CAP,
  invitationCapFor,
  invitesAboveMember,
  orgEndpointPolicy,
  requestedOrgRoles,
} from "./org-plugin-guard";
import {
  GENERIC_INVITATION_ERROR,
  invitationErrorMessage,
  isBatchStoppingInvitationError,
} from "./invitation-errors";

describe("orgEndpointPolicy", () => {
  it("refuses deletion, church edits, role changes and plugin-side accepts", () => {
    expect(orgEndpointPolicy("/organization/delete")).toBe("never");
    expect(orgEndpointPolicy("/organization/update")).toBe("never");
    expect(orgEndpointPolicy("/organization/update-member-role")).toBe("never");
    expect(orgEndpointPolicy("/organization/accept-invitation")).toBe("never");
  });

  it("holds invites, cancels and removals to team.manage", () => {
    expect(orgEndpointPolicy("/organization/invite-member")).toBe("team");
    expect(orgEndpointPolicy("/organization/cancel-invitation")).toBe("team");
    expect(orgEndpointPolicy("/organization/remove-member")).toBe("team");
  });

  it("leaves everything else to the plugin", () => {
    expect(orgEndpointPolicy("/organization/set-active")).toBeNull();
    expect(orgEndpointPolicy("/get-session")).toBeNull();
    expect(orgEndpointPolicy(undefined)).toBeNull();
  });

  /*
   * A path that the plugin renames would silently fall out of both lists, and
   * the endpoint would be open again. Read the installed plugin and check every
   * guarded path is still one of its routes.
   */
  it("names only paths the installed plugin really mounts", () => {
    const dir = path.resolve(
      import.meta.dirname,
      "../../node_modules/better-auth/dist/plugins/organization/routes",
    );
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    for (const p of [...NEVER_PATHS, ...TEAM_PATHS]) {
      expect(source, p).toContain(`createAuthEndpoint("${p}"`);
    }
  });
});

/*
 * A plain "admin" invitation is the legacy full-access fallback once accepted,
 * so the guard has to recognise one however the plugin lets it be spelled.
 */
describe("requestedOrgRoles", () => {
  it("reads a string, an array and a comma-separated list", () => {
    expect(requestedOrgRoles("member")).toEqual(["member"]);
    expect(requestedOrgRoles(["member", "admin"])).toEqual(["member", "admin"]);
    expect(requestedOrgRoles("member, admin")).toEqual(["member", "admin"]);
  });

  it("finds admin hidden in any of those shapes", () => {
    expect(invitesAboveMember("admin")).toBe(true);
    expect(invitesAboveMember(["admin"])).toBe(true);
    expect(invitesAboveMember("member,admin")).toBe(true);
    expect(invitesAboveMember("owner")).toBe(true);
  });

  it("lets a plain member invitation through", () => {
    expect(invitesAboveMember("member")).toBe(false);
    expect(invitesAboveMember(["member"])).toBe(false);
    expect(invitesAboveMember(undefined)).toBe(false);
  });

  it("never waves through a shape it does not understand", () => {
    expect(invitesAboveMember({ role: "admin" })).toBe(true);
    expect(invitesAboveMember([42])).toBe(true);
  });
});

describe("invitationCapFor", () => {
  it("is never below the plugin's old 100", () => {
    expect(invitationCapFor("starter")).toBeGreaterThanOrEqual(100);
    expect(invitationCapFor(null)).toBeGreaterThanOrEqual(100);
  });
  it("is finite for an unlimited plan", () => {
    expect(invitationCapFor("pro")).toBeLessThanOrEqual(UNLIMITED_PLAN_INVITATION_CAP);
  });
});

describe("invitation error messages", () => {
  const apiError = (code: string, message = "raw library text") => ({
    body: { code, message },
  });

  it("names the invitation limit and what to do, instead of 'try again'", () => {
    const msg = invitationErrorMessage(apiError("INVITATION_LIMIT_REACHED"));
    expect(msg).toMatch(/waiting to be accepted/);
    expect(msg).not.toBe(GENERIC_INVITATION_ERROR);
  });

  it("explains the refusals the Team page's plain invite can now meet", () => {
    for (const code of [
      "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
      "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
    ]) {
      expect(invitationErrorMessage(apiError(code))).not.toBe(GENERIC_INVITATION_ERROR);
    }
    expect(
      invitationErrorMessage(apiError("FI_ROLE_NOT_ALLOWED", "Only someone who holds every permission.")),
    ).toBe("Only someone who holds every permission.");
  });

  it("passes our own FI_ refusals through as written", () => {
    expect(invitationErrorMessage(apiError("FI_TEAM_FULL", "Your plan covers 3."))).toBe(
      "Your plan covers 3.",
    );
  });

  it("never leaks an unrecognised library message", () => {
    expect(invitationErrorMessage(apiError("SOMETHING_NEW"))).toBe(GENERIC_INVITATION_ERROR);
    expect(invitationErrorMessage(new Error("boom"))).toBe(GENERIC_INVITATION_ERROR);
  });

  it("stops a bulk invite on a refusal every later member would hit", () => {
    expect(isBatchStoppingInvitationError(apiError("INVITATION_LIMIT_REACHED"))).toBe(true);
    expect(isBatchStoppingInvitationError(apiError("FI_DEMO_CHURCH"))).toBe(true);
    expect(isBatchStoppingInvitationError(apiError("INVALID_EMAIL"))).toBe(false);
  });
});
