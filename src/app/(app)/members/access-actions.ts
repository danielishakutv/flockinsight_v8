"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invitation, member, role, staff, staffInvite, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { betterAuthRoleFor } from "@/lib/staff-access";

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
  | { ok: false; error: string };

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

/** Validate a church role and return its permissions. */
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
  return { permissions: r.permissions ?? [] };
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

  // Reuse a pending invitation for this email rather than stacking duplicates.
  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.church.id),
        eq(invitation.status, "pending"),
        sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);

  let invitationId: string;
  if (pending) {
    invitationId = pending.id;
    // Keep the org role in step with the role we're about to attach.
    await db
      .update(invitation)
      .set({ role: orgRole })
      .where(eq(invitation.id, invitationId));
  } else {
    try {
      const created = await auth.api.createInvitation({
        body: {
          email,
          role: orgRole,
          organizationId: ctx.church.id,
        },
        headers: await headers(),
      });
      invitationId = created.id;
    } catch (e) {
      console.error("[access] createInvitation failed", e);
      return {
        ok: false,
        error: "Could not create the invitation. Please try again.",
      };
    }
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

  // Validate the role once instead of per member.
  if (input.roleId) {
    const r = await loadRole(ctx.church.id, input.roleId);
    if ("error" in r) return { ok: false, error: r.error };
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

  // One member's problem must not abort the rest of the batch.
  for (const memberId of input.memberIds) {
    const res = await inviteMemberAsStaff({ memberId, roleId: input.roleId });
    if (res.ok) invited++;
    else {
      skipped.push({
        memberId,
        name: nameById.get(memberId) ?? "This member",
        reason: res.error,
      });
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

  await db.transaction(async (tx) => {
    if (s) await tx.delete(staff).where(eq(staff.id, s.id));

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
