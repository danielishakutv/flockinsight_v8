"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, count, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  invitation,
  member,
  role,
  staff,
  staffInvite,
  user,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireChurch } from "@/lib/session";
import { teamLimitStatus } from "@/lib/entitlements-server";
import { planName } from "@/lib/plans";
import { can, getAccess } from "@/lib/permissions";
import { betterAuthRoleFor } from "@/lib/staff-access";
import { beyondYourOwnMessage, permissionsBeyond } from "@/lib/staff-permissions";
import { refuseIfDemo } from "@/lib/demo";
import {
  invitationErrorMessage,
  isBatchStoppingInvitationError,
} from "@/lib/invitation-errors";
import { invitationCapForChurch } from "@/lib/org-plugin-guard";
import { repointSessionsLeaving } from "@/lib/session-pointer";

/**
 * Giving an existing congregation member a login and a church role.
 *
 * Authorisation runs here, server-side, against our own `team.manage`
 * permission. The previous flow called `organization.inviteMember` from the
 * client, where Better Auth checks its *own* org role instead — so a custom
 * role granting "Manage team" opened the Team page and then failed on invite.
 */

export type AccessResult =
  | { ok: true; invitationId: string }
  /**
   * `stopBatch`: a refusal no later invitation in the same batch can get past
   * (the church's invitation cap, its team size, the demo church). The bulk
   * invite stops there instead of making N more doomed calls.
   */
  | { ok: false; error: string; stopBatch?: boolean };

export type BulkAccessResult =
  | {
      ok: true;
      invited: number;
      skipped: { memberId: string; name: string; reason: string }[];
    }
  | { ok: false; error: string };

const emailSchema = z.string().trim().email();

/**
 * `can()` rather than `requireCan()`: the latter redirects, which inside a
 * server action throws instead of returning something the UI can show.
 */
async function guard() {
  const ctx = await requireChurch();
  if (!(await can("team.manage"))) {
    return {
      ctx,
      error: "You don't have permission to manage the team." as const,
    };
  }
  return { ctx, error: null };
}

function fullName(firstName: string, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

/**
 * Validate a church role and return its permissions.
 *
 * Inviting somebody onto a role gives them all of it, so the caller must hold
 * all of it themselves, the same rule assignRole applies after they accept.
 */
async function loadRole(
  churchId: string,
  roleId: string,
): Promise<{ permissions: string[] } | { error: string }> {
  const [r] = await db
    .select({ isSystem: role.isSystem, permissions: role.permissions })
    .from(role)
    .where(and(eq(role.id, roleId), eq(role.churchId, churchId)))
    .limit(1);
  if (!r) return { error: "Role not found." };
  if (r.isSystem) return { error: "The Owner role can't be assigned." };
  const permissions = r.permissions ?? [];
  const beyond = permissionsBeyond(await getAccess(), permissions);
  if (beyond.length > 0) return { error: beyondYourOwnMessage(beyond) };
  return { permissions };
}

function revalidateAccess(memberId: string) {
  revalidatePath("/members");
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/settings/team");
}

export async function inviteMemberAsStaff(input: {
  memberId: string;
  roleId: string | null;
  /** Only used when the member has no email on file; saved to their profile. */
  email?: string;
}): Promise<AccessResult> {
  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  // An invitation is an email to an address somebody typed. Not from the demo.
  const demoRefusal = await refuseIfDemo(ctx.church.id, "Inviting people");
  if (demoRefusal) return demoRefusal;

  /*
   * The plan's team size, which was advertised from the beginning and enforced
   * nowhere — hence one church on Starter with twelve administrators.
   *
   * Nobody already on the team is touched. This stops the NEXT invitation, the
   * same way the member limit stops the next member (lib/plan-limits.ts).
   */
  const team = await teamLimitStatus(ctx.church.id);
  if (team.atLimit) {
    return {
      ok: false,
      error: `Your ${planName(team.plan)} plan covers ${team.limit} team ${team.limit === 1 ? "member" : "members"}, and you have ${team.used}. Upgrade to give more people their own login.`,
    };
  }

  const [m] = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      userId: member.userId,
    })
    .from(member)
    .where(and(eq(member.id, input.memberId), eq(member.churchId, ctx.church.id)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };
  if (m.userId) return { ok: false, error: "This member already has app access." };

  // Their own email wins; otherwise the one typed into the dialog.
  const supplied = (input.email ?? "").trim();
  const raw = m.email?.trim() || supplied;
  if (!raw) {
    return {
      ok: false,
      error: "This member has no email address — add one to invite them.",
    };
  }
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }
  const email = parsed.data;

  // Fill in the gap permanently rather than only using it for this invite.
  if (!m.email?.trim()) {
    await db.update(member).set({ email }).where(eq(member.id, m.id));
  }

  // Someone already on the team with that email would mean two logins for one
  // person — refuse rather than create the tangle.
  const [existingStaff] = await db
    .select({ id: staff.id })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(
      and(
        eq(staff.organizationId, ctx.church.id),
        eq(staff.temp, false),
        sql`lower(${user.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (existingStaff) {
    return { ok: false, error: "Someone with that email is already on the team." };
  }

  let permissions: string[] = [];
  if (input.roleId) {
    const r = await loadRole(ctx.church.id, input.roleId);
    if ("error" in r) return { ok: false, error: r.error };
    permissions = r.permissions;
  }
  const orgRole = betterAuthRoleFor(permissions);

  /*
   * One live invitation per person, and every invite actually sends an email.
   *
   * This used to reuse ANY pending row for the email — including one that had
   * expired days ago — and send nothing. Re-inviting somebody whose link had
   * run out therefore changed a role column on a dead invitation and told the
   * admin "Invitation sent". Now:
   *
   * - an expired pending row is retired (status "canceled", the same word the
   *   org plugin writes) so it neither lingers as "pending" nor is reused;
   * - a live one is re-sent through the plugin (`resend: true`), which extends
   *   its expiry and emails the same link again;
   * - otherwise a fresh invitation is created, which emails it.
   */
  const now = new Date();
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.organizationId, ctx.church.id),
        eq(invitation.status, "pending"),
        lte(invitation.expiresAt, now),
        sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
      ),
    );

  const [live] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.church.id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, now),
        sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);

  // A live invitation is re-sent below and only then tied to the new role, so
  // until that tie exists it reads as "member". Writing "admin" here first left
  // a plain admin invitation (everything, once accepted) whenever the re-send
  // failed or the invitation had no role attached yet. The role's own org role
  // is written after staff_invite, as for a new invitation.
  if (live) {
    await db
      .update(invitation)
      .set({ role: "member" })
      .where(eq(invitation.id, live.id));
  }

  /*
   * The plugin is always asked for "member". lib/org-plugin-guard.ts refuses
   * an "admin" invitation from anyone who does not hold every permission,
   * because a plain admin seat with no church role is the legacy full-access
   * fallback. This invitation is not plain: once staff_invite ties it to the
   * role checked above, the org role that role implies is written below.
   */
  let invitationId: string;
  try {
    const created = await auth.api.createInvitation({
      body: {
        email,
        role: "member",
        organizationId: ctx.church.id,
        resend: live ? true : undefined,
      },
      headers: await headers(),
    });
    invitationId = created.id;
  } catch (e) {
    console.error("[access] createInvitation failed", e);
    return {
      ok: false,
      error: invitationErrorMessage(e),
      stopBatch: isBatchStoppingInvitationError(e),
    };
  }

  // invitation_id is unique, so re-inviting the same person with a different
  // role has to update rather than insert.
  await db
    .insert(staffInvite)
    .values({ invitationId, memberId: m.id, roleId: input.roleId })
    .onConflictDoUpdate({
      target: staffInvite.invitationId,
      set: { memberId: m.id, roleId: input.roleId },
    });

  // Now that the role is attached. Until this lands the invitation reads as
  // "member" with that role, which grants the role and nothing more.
  if (orgRole !== "member") {
    await db
      .update(invitation)
      .set({ role: orgRole })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, ctx.church.id),
          eq(invitation.status, "pending"),
        ),
      );
  }

  revalidateAccess(m.id);
  return { ok: true, invitationId };
}

export async function inviteMembersAsStaff(input: {
  memberIds: string[];
  roleId: string | null;
}): Promise<BulkAccessResult> {
  const { ctx, error } = await guard();
  if (error) return { ok: false, error };
  if (input.memberIds.length === 0) {
    return { ok: false, error: "Select at least one member." };
  }

  /*
   * The whole batch is checked against the remaining room, before any of it is
   * sent. Letting a batch of ten through on a plan with two places left and
   * failing eight of them silently is how a limit becomes a mystery.
   */
  const team = await teamLimitStatus(ctx.church.id);
  if (team.limit !== null) {
    const room = Math.max(0, team.limit - team.used);
    if (input.memberIds.length > room) {
      return {
        ok: false,
        error:
          room === 0
            ? `Your ${planName(team.plan)} plan covers ${team.limit} team ${team.limit === 1 ? "member" : "members"}, and you have ${team.used}. Upgrade to give more people their own login.`
            : `Your ${planName(team.plan)} plan has room for ${room} more team ${room === 1 ? "member" : "members"}. Select ${room} or fewer, or upgrade.`,
      };
    }
  }

  // Validate the role once instead of per member.
  if (input.roleId) {
    const r = await loadRole(ctx.church.id, input.roleId);
    if ("error" in r) return { ok: false, error: r.error };
  }

  /*
   * Room for this many more invitations waiting to be accepted. The org plugin
   * refuses every invite past its cap ("Invitation limit reached"), and used to
   * do so one member at a time, each reported as "please try again" — which
   * retrying could never fix. Count the live ones first and say so up front.
   */
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.church.id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );
  const cap = await invitationCapForChurch(ctx.church.id);
  const pendingN = Number(pending);
  if (pendingN + input.memberIds.length > cap) {
    const room = Math.max(0, cap - pendingN);
    return {
      ok: false,
      error:
        room === 0
          ? `Your church already has ${pendingN} invitations waiting to be accepted. Cancel some in Settings → Team (or wait for them to expire), then try again.`
          : `Your church has ${pendingN} invitations waiting to be accepted, so there is room for ${room} more. Select ${room} or fewer, or cancel some in Settings → Team.`,
    };
  }

  const names = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
    })
    .from(member)
    .where(eq(member.churchId, ctx.church.id));
  const nameById = new Map(
    names.map((n) => [n.id, fullName(n.firstName, n.lastName)]),
  );

  let invited = 0;
  const skipped: { memberId: string; name: string; reason: string }[] = [];

  // One member's problem must not abort the rest of the batch — unless it is
  // a problem every later member would hit too; then say it once for each and
  // stop calling.
  for (let i = 0; i < input.memberIds.length; i++) {
    const memberId = input.memberIds[i];
    const res = await inviteMemberAsStaff({ memberId, roleId: input.roleId });
    if (res.ok) {
      invited++;
      continue;
    }
    skipped.push({
      memberId,
      name: nameById.get(memberId) ?? "This member",
      reason: res.error,
    });
    if (res.stopBatch) {
      for (const rest of input.memberIds.slice(i + 1)) {
        skipped.push({
          memberId: rest,
          name: nameById.get(rest) ?? "This member",
          reason: res.error,
        });
      }
      break;
    }
  }

  return { ok: true, invited, skipped };
}

export async function revokeMemberAccess(
  memberId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  const [m] = await db
    .select({ id: member.id, userId: member.userId, email: member.email })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.churchId, ctx.church.id)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };
  if (!m.userId) return { ok: false, error: "This member doesn't have app access." };
  if (m.userId === ctx.user.id) {
    return { ok: false, error: "You can't remove your own access." };
  }

  const [s] = await db
    .select({ id: staff.id, role: staff.role })
    .from(staff)
    .where(
      and(eq(staff.organizationId, ctx.church.id), eq(staff.userId, m.userId)),
    )
    .limit(1);
  if (s?.role === "owner") {
    return { ok: false, error: "The church owner's access can't be removed." };
  }

  const removedUserId = m.userId;
  await db.transaction(async (tx) => {
    if (s) await tx.delete(staff).where(eq(staff.id, s.id));

    /*
     * Removed means removed now, not when their session next expires.
     *
     * Their sessions still point at this church. requireChurch() refuses a
     * church without a genuine seat, but clearing the pointer as well means
     * nothing that reads activeOrganizationId straight off the session (the
     * notification routes, the org plugin) keeps answering them either. Only
     * sessions aimed at THIS church, and they move to another church the
     * person still belongs to rather than to nothing — a null pointer reads
     * as "create your church" (lib/session-pointer.ts).
     */
    await repointSessionsLeaving(tx, removedUserId, ctx.church.id);

    // Keep the person and every record they touched — this removes a login,
    // not a member.
    await tx.update(member).set({ userId: null }).where(eq(member.id, m.id));

    // Otherwise an old emailed link would silently re-grant what was just
    // revoked.
    if (m.email) {
      await tx
        .update(invitation)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(invitation.organizationId, ctx.church.id),
            eq(invitation.status, "pending"),
            sql`lower(${invitation.email}) = ${m.email.toLowerCase()}`,
          ),
        );
    }
  });

  revalidateAccess(m.id);
  return { ok: true };
}

/** Cancel a pending invitation for a member, without touching their record. */
export async function cancelMemberInvite(
  memberId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  const rows = await db
    .select({ invitationId: staffInvite.invitationId })
    .from(staffInvite)
    .innerJoin(invitation, eq(invitation.id, staffInvite.invitationId))
    .where(
      and(
        eq(staffInvite.memberId, memberId),
        eq(invitation.organizationId, ctx.church.id),
        eq(invitation.status, "pending"),
      ),
    );
  if (rows.length === 0) {
    return { ok: false, error: "There's no pending invitation for this member." };
  }

  for (const r of rows) {
    await db
      .update(invitation)
      .set({ status: "cancelled" })
      .where(eq(invitation.id, r.invitationId));
  }

  revalidateAccess(memberId);
  return { ok: true };
}

/** Members with no login yet — candidates for an invitation. */
export async function invitableMembers(): Promise<
  { id: string; name: string; email: string | null }[]
> {
  const ctx = await requireChurch();
  const rows = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
    })
    .from(member)
    .where(and(eq(member.churchId, ctx.church.id), isNull(member.userId)))
    .limit(1000);

  return rows.map((r) => ({
    id: r.id,
    name: fullName(r.firstName, r.lastName),
    email: r.email,
  }));
}
