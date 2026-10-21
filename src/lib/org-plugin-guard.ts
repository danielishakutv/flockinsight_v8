import { and, count, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { db } from "@/db";
import { church, invitation, platformRole, staff, user } from "@/db/schema";
import { teamLimitFor } from "@/lib/entitlements";
import { ALL_PERMISSIONS } from "@/lib/permissions-catalog";
import { accessHas, loadStaffAccess, permissionsBeyond } from "@/lib/staff-permissions";

/**
 * The app's permission model, applied to Better Auth's organization plugin.
 *
 * The plugin mounts its own endpoints at /api/auth/organization/*, and every one
 * of them answered any signed-in church user directly, judged only by the
 * plugin's own owner/admin/member column — never by the church roles the app
 * actually runs on. So:
 *
 * - somebody whose church role had lost "Manage team" kept a stale "admin" and
 *   could still invite and remove staff with a hand-written fetch;
 * - the shared demo login (its password is printed on the sign-in page) could
 *   make FlockInsight email "You're invited" to any address, and pile up
 *   invitations until every church-side invite failed with "Invitation limit
 *   reached";
 * - any church owner could POST /organization/delete and cascade away the
 *   church, its payments and its ledgers, with no confirmation, audit or backup;
 * - an invitation could be accepted straight through the plugin, skipping the
 *   app's own accept flow — no plan check, and an "admin" seat with no church
 *   role, which is the legacy full-access fallback.
 *
 * Two layers, both wired in lib/auth.ts:
 *
 * 1. NEVER_PATHS are refused outright, over HTTP (`disabledPaths`) AND from
 *    server code (the `hooks.before` below). Nothing in the app calls them;
 *    church edits and deletion have their own audited paths.
 * 2. TEAM_PATHS are allowed only to someone who holds `team.manage` in the
 *    church concerned — read through the same resolver as `getAccess()`
 *    (lib/staff-permissions.ts), so the two can never disagree — or a
 *    superadmin acting as that church. Invites are also refused for the demo
 *    church and for a church at its plan's team size.
 *
 * Errors carry an `FI_` code and a sentence written for the admin reading it;
 * lib/invitation-errors.ts passes those through untouched.
 */

/** Refused for everyone, from everywhere. */
export const NEVER_PATHS = [
  "/organization/update",
  "/organization/delete",
  "/organization/update-member-role",
  "/organization/accept-invitation",
] as const;

/** Allowed only with the app's `team.manage` in the church concerned. */
export const TEAM_PATHS = [
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/remove-member",
] as const;

export type OrgEndpointPolicy = "never" | "team" | null;

/** Pure: which rule governs this plugin path, if any. */
export function orgEndpointPolicy(path: string | undefined | null): OrgEndpointPolicy {
  if (!path) return null;
  if ((NEVER_PATHS as readonly string[]).includes(path)) return "never";
  if ((TEAM_PATHS as readonly string[]).includes(path)) return "team";
  return null;
}

/**
 * How many unexpired pending invitations one church may hold at once.
 *
 * The plugin's default is a flat 100 for everybody, which a Pro church (no team
 * limit) inviting a large staff in bulk hit, and then every further invite
 * failed. Sized from the plan instead: never below the old 100, and a finite
 * ceiling for an unlimited plan so a flood still stops somewhere.
 */
export const UNLIMITED_PLAN_INVITATION_CAP = 1000;
export function invitationCapFor(plan: string | null | undefined): number {
  const team = teamLimitFor(plan);
  return team === null ? UNLIMITED_PLAN_INVITATION_CAP : Math.max(team, 100);
}

export async function invitationCapForChurch(churchId: string): Promise<number> {
  const [c] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  return invitationCapFor(c?.plan);
}

/**
 * Retire a church's expired invitations.
 *
 * The plugin already ignores them when counting, but they sat as "pending"
 * for ever — on the Team page, and in anything else that reads the status.
 * "canceled" is the plugin's own word for a withdrawn invitation.
 */
export async function retireExpiredInvitations(churchId: string): Promise<number> {
  const rows = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.organizationId, churchId),
        eq(invitation.status, "pending"),
        lte(invitation.expiresAt, new Date()),
      ),
    )
    .returning({ id: invitation.id });
  return rows.length;
}

function refuse(code: string, message: string): never {
  throw APIError.from("FORBIDDEN", { code, message });
}

/**
 * A superadmin acting as the church: a `temp` seat there, and the platform
 * permission to act as a church, read now — the same test getActAsChurchId()
 * applies, from the database because the act-as cookie is not visible here.
 */
async function isActingSuperadmin(userId: string, churchId: string): Promise<boolean> {
  const [seat] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.userId, userId),
        eq(staff.organizationId, churchId),
        eq(staff.temp, true),
      ),
    )
    .limit(1);
  if (!seat) return false;
  const [u] = await db
    .select({
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.platformRoleId,
      permissions: platformRole.permissions,
    })
    .from(user)
    .leftJoin(platformRole, eq(platformRole.id, user.platformRoleId))
    .where(eq(user.id, userId))
    .limit(1);
  if (!u?.isSuperAdmin) return false;
  return u.roleId === null || (u.permissions ?? []).includes("platform.churches.manage");
}

/**
 * Bring the caller's plugin role up to what the app has just decided.
 *
 * Only called once the caller is known to hold `team.manage` through their
 * church role. Roles edited before lib/role-sync.ts existed can still carry
 * "member" on a role that has since gained "Manage team"; the plugin would
 * then refuse an invite the app has just authorised ("You are not allowed to
 * invite users to this organization"). The church role is the declared truth
 * and staff.role a copy of it, so the copy is repaired here, before the plugin
 * reads it. Only ever upward, and only from "member": an owner or an existing
 * admin is left exactly as they are.
 */
async function healCallerOrgRole(userId: string, churchId: string): Promise<void> {
  await db
    .update(staff)
    .set({ role: "admin" })
    .where(
      and(
        eq(staff.userId, userId),
        eq(staff.organizationId, churchId),
        eq(staff.temp, false),
        eq(staff.role, "member"),
        isNotNull(staff.roleId),
      ),
    );
}

export type TeamCallInput = {
  path: string;
  userId: string;
  /** The church the call is about (already resolved by the caller). */
  churchId: string;
  /** invite-member's `resend: true` re-sends an existing invitation. */
  resend?: boolean;
  /** invite-member's `email`, to check a resend really is one. */
  email?: string | null;
  /** invite-member's `role`, exactly as it arrived. */
  role?: unknown;
};

/**
 * The org roles an invite-member call asks for, however it spells them. The
 * plugin takes a string, an array, or a comma-separated list, so all three are
 * read. Anything that is not a string is kept as something that is not
 * "member", so a shape this does not understand is never waved through.
 */
export function requestedOrgRoles(raw: unknown): string[] {
  const parts: unknown[] = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return parts
    .flatMap((r) => (typeof r === "string" ? r.split(",") : [String(r)]))
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Does this invitation ask for more than a plain member seat? */
export function invitesAboveMember(raw: unknown): boolean {
  return requestedOrgRoles(raw).some((r) => r !== "member");
}

/**
 * Is there a live invitation to this address in this church — the one thing
 * that makes `resend: true` a resend?
 *
 * The plugin re-sends only when it finds one (same test: lower-cased email,
 * pending, not expired) and otherwise falls through to creating a NEW
 * invitation. Trusting the flag alone let `{ email: <new>, resend: true }`
 * walk past the team-size check below.
 */
async function hasLivePendingInvite(churchId: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, churchId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
        sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * The check for a TEAM_PATHS call. Throws an APIError to refuse; returns to
 * let the plugin carry on with its own checks.
 */
export async function guardTeamCall(input: TeamCallInput): Promise<void> {
  const { path, userId, churchId } = input;
  const [c] = await db
    .select({ isDemo: church.isDemo })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  // Unknown church: let the plugin answer "organization not found".
  if (!c) return;

  const acting = await isActingSuperadmin(userId, churchId);

  // The demo church is shared by everyone who knows its password. Not an
  // email relay, and not something one visitor can take apart for the next.
  if (c.isDemo && !acting && path !== "/organization/cancel-invitation") {
    refuse(
      "FI_DEMO_CHURCH",
      "The demo church can't invite or remove people. Create your own church to build a team.",
    );
  }

  if (!acting) {
    const access = await loadStaffAccess(userId, churchId);
    if (!accessHas(access, "team.manage")) {
      refuse("FI_NOT_ALLOWED", "You don't have permission to manage the team.");
    }
    /*
     * A plain "admin" invitation is an invitation to EVERYTHING: it carries no
     * church role, and an admin seat with no role is the legacy full-access
     * fallback (lib/staff-permissions.ts). So only somebody who already holds
     * every permission may send one. Without this, a secretary limited to the
     * register invited a second address of her own as admin and accepted it.
     * Invitations onto a church role go through inviteMemberAsStaff, which
     * checks the role against the caller and asks the plugin for "member".
     */
    if (
      path === "/organization/invite-member" &&
      invitesAboveMember(input.role) &&
      permissionsBeyond(access, ALL_PERMISSIONS).length > 0
    ) {
      refuse(
        "FI_ROLE_NOT_ALLOWED",
        "Only someone who holds every permission, such as the church owner, can invite a full admin. Invite them as a member, then give them a role on the Team page.",
      );
    }
    await healCallerOrgRole(userId, churchId);
  }

  if (path === "/organization/invite-member") {
    await retireExpiredInvitations(churchId);
    /*
     * The plan's team size, for the plain email invite too. inviteMemberAsStaff
     * already checks it; the client's plain invite came straight here and did
     * not. A resend is the same seat, not a new one — when it is one.
     *
     * Temp rows (a superadmin acting as the church) are not seats and are not
     * counted, so an operator helping a church never pushes it over its plan.
     */
    const resending =
      input.resend === true &&
      typeof input.email === "string" &&
      (await hasLivePendingInvite(churchId, input.email));
    if (!resending) {
      const [p] = await db
        .select({ plan: church.plan })
        .from(church)
        .where(eq(church.id, churchId))
        .limit(1);
      const limit = teamLimitFor(p?.plan);
      if (limit !== null) {
        const [{ used }] = await db
          .select({ used: count() })
          .from(staff)
          .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)));
        if (Number(used) >= limit) {
          refuse(
            "FI_TEAM_FULL",
            `Your plan covers ${limit} team ${limit === 1 ? "member" : "members"}, and you have ${Number(used)}. Upgrade to give more people their own login.`,
          );
        }
      }
    }
  }
}

/** Which church a TEAM_PATHS call is about, from its body and session. */
export async function churchForTeamCall(
  path: string,
  body: Record<string, unknown> | undefined,
  activeChurchId: string | null | undefined,
): Promise<string | null> {
  if (path === "/organization/cancel-invitation") {
    const id = typeof body?.invitationId === "string" ? body.invitationId : null;
    if (!id) return null;
    const [inv] = await db
      .select({ orgId: invitation.organizationId })
      .from(invitation)
      .where(eq(invitation.id, id))
      .limit(1);
    return inv?.orgId ?? null;
  }
  const explicit =
    typeof body?.organizationId === "string" && body.organizationId
      ? body.organizationId
      : null;
  return explicit ?? activeChurchId ?? null;
}

export function refuseNeverPath(): never {
  refuse(
    "FI_NOT_AVAILABLE",
    "That isn't available here. Church details are changed in Settings, and invitations are accepted from the emailed link.",
  );
}
