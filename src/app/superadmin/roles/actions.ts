"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { platformRole, user } from "@/db/schema";
import {
  canPlatform,
  platformAccess,
  requirePlatform,
} from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { ALL_PLATFORM_PERMISSIONS } from "@/lib/platform-permissions";

export type RoleResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).optional().default(""),
  permissions: z.array(z.string()).max(200),
});

/**
 * Create or edit an admin role.
 *
 * Unknown permission keys are dropped rather than stored. A key that no longer
 * exists in the catalogue is dead weight that looks like access, and one that
 * never existed is somebody probing the form.
 */
export async function saveRole(
  input: z.input<typeof schema>,
): Promise<RoleResult> {
  const admin = await requirePlatform("platform.roles.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const known = new Set(ALL_PLATFORM_PERMISSIONS);
  const permissions = [...new Set(d.permissions.filter((p) => known.has(p)))];

  try {
    if (d.id) {
      const [row] = await db
        .update(platformRole)
        .set({
          name: d.name,
          description: d.description || null,
          permissions,
          updatedAt: new Date(),
        })
        .where(eq(platformRole.id, d.id))
        .returning({ id: platformRole.id });
      if (!row) return { ok: false, error: "That role no longer exists." };
    } else {
      await db.insert(platformRole).values({
        name: d.name,
        description: d.description || null,
        permissions,
      });
    }
  } catch (e) {
    if ((e as { code?: string })?.code === "23505")
      return { ok: false, error: "A role with that name already exists." };
    console.error("saveRole failed", e);
    return { ok: false, error: "Could not save the role." };
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: d.id ? "platform_role.update" : "platform_role.create",
    summary: `${d.id ? "Updated" : "Created"} admin role "${d.name}" with ${permissions.length} permission${permissions.length === 1 ? "" : "s"}`,
    targetType: "platform_role",
    targetId: d.id ?? null,
  });

  revalidatePath("/superadmin/roles");
  return { ok: true };
}

/**
 * Delete a role nobody holds.
 *
 * Refused while anyone is assigned, and not only to avoid a dangling
 * reference: a null role means UNRESTRICTED here, so quietly detaching people
 * from a deleted role would promote every one of them to full access — the
 * exact opposite of what deleting their role is meant to do. The foreign key
 * is RESTRICT for the same reason; this is the readable half of that pair.
 */
export async function deleteRole(id: string): Promise<RoleResult> {
  const admin = await requirePlatform("platform.roles.manage");
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [{ n }] = await db
    .select({ n: count() })
    .from(user)
    .where(eq(user.platformRoleId, id));
  if (n > 0)
    return {
      ok: false,
      error: `${n} admin${n === 1 ? " is" : "s are"} still on this role. Move ${n === 1 ? "them" : "them"} to another role first.`,
    };

  const [row] = await db
    .delete(platformRole)
    .where(eq(platformRole.id, id))
    .returning({ name: platformRole.name });
  if (!row) return { ok: false, error: "That role no longer exists." };

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform_role.delete",
    summary: `Deleted admin role "${row.name}"`,
    targetType: "platform_role",
    targetId: id,
  });

  revalidatePath("/superadmin/roles");
  return { ok: true };
}

/**
 * Put an admin on a role, or take them off it.
 *
 * `roleId: null` means unrestricted, which is why it cannot be done casually:
 * it is a promotion to full access, not a removal.
 */
export async function assignRole(input: {
  userId: string;
  roleId: string | null;
}): Promise<RoleResult> {
  const admin = await requirePlatform("platform.roles.manage");
  if (!z.string().min(1).safeParse(input.userId).success)
    return { ok: false, error: "Invalid id" };
  if (input.roleId !== null && !z.string().uuid().safeParse(input.roleId).success)
    return { ok: false, error: "Invalid role" };

  /*
   * Nobody may narrow their own access.
   *
   * Not a safety rail so much as a usability one: putting yourself on a role
   * without platform.roles.manage locks you out of the only page that could
   * undo it, and the only way back is the database.
   */
  if (input.userId === admin.id) {
    return {
      ok: false,
      error:
        "You cannot change your own role here — ask another full admin to do it.",
    };
  }

  const [target] = await db
    .select({ name: user.name, isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!target) return { ok: false, error: "That account no longer exists." };
  if (!target.isSuperAdmin)
    return {
      ok: false,
      error: "Give them admin access first, then choose their role.",
    };

  let roleName = "Full access";
  if (input.roleId) {
    const [r] = await db
      .select({ name: platformRole.name })
      .from(platformRole)
      .where(eq(platformRole.id, input.roleId))
      .limit(1);
    if (!r) return { ok: false, error: "That role no longer exists." };
    roleName = r.name;
  }

  await db
    .update(user)
    .set({ platformRoleId: input.roleId })
    .where(eq(user.id, input.userId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform_role.assign",
    summary: `Set ${target.name ?? "an admin"} to ${roleName}`,
    targetType: "user",
    targetId: input.userId,
  });

  revalidatePath("/superadmin/roles");
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/** Who currently holds admin access, and on what role. */
export async function currentAdmins() {
  await requirePlatform("platform.roles.manage");
  const me = await platformAccess();
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.platformRoleId,
      roleName: platformRole.name,
    })
    .from(user)
    .leftJoin(platformRole, eq(platformRole.id, user.platformRoleId))
    .where(eq(user.isSuperAdmin, true));
  return rows.map((r) => ({ ...r, isSelf: r.id === me?.id }));
}

/**
 * Accounts that could be made an admin, matching a search.
 *
 * A search rather than a list of everybody: there are thousands of accounts
 * and only ever a handful of admins, so a dropdown of the lot is both slow to
 * render and a good way to promote the wrong person with a common name. Two
 * characters minimum, ten results, already-admins excluded — they are on the
 * list below the search and do not need granting twice.
 */
export async function searchAdminCandidates(query: string) {
  await requirePlatform("platform.users.manage");
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      and(
        eq(user.isSuperAdmin, false),
        or(ilike(user.email, like), ilike(user.name, like)),
      ),
    )
    .orderBy(asc(user.email))
    .limit(10);
}

/**
 * Give an existing account admin access, and its role in the same step.
 *
 * Both at once on purpose. Granting access and then choosing what it may do
 * used to be two screens, so the gap between them was a live account with
 * unrestricted access — brief, but real, and easy to forget to close.
 */
export async function addAdmin(input: {
  userId: string;
  roleId: string | null;
}): Promise<RoleResult> {
  const admin = await requirePlatform("platform.roles.manage");
  // Handing out platform access is a users.manage act; choosing the role is a
  // roles.manage one. Doing both in one step needs both.
  if (!(await canPlatform("platform.users.manage")))
    return { ok: false, error: "You cannot grant admin access." };
  if (!z.string().min(1).safeParse(input.userId).success)
    return { ok: false, error: "Invalid id" };
  if (input.roleId !== null && !z.string().uuid().safeParse(input.roleId).success)
    return { ok: false, error: "Invalid role" };

  const [target] = await db
    .select({ name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!target) return { ok: false, error: "That account no longer exists." };
  if (target.isSuperAdmin)
    return { ok: false, error: "They already have admin access." };

  let roleName = "Full access";
  if (input.roleId) {
    const [r] = await db
      .select({ name: platformRole.name })
      .from(platformRole)
      .where(eq(platformRole.id, input.roleId))
      .limit(1);
    if (!r) return { ok: false, error: "That role no longer exists." };
    roleName = r.name;
  }

  await db
    .update(user)
    .set({
      isSuperAdmin: true,
      platformRoleId: input.roleId,
      updatedAt: new Date(),
    })
    .where(eq(user.id, input.userId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "grant_superadmin",
    summary: `Gave ${target.name ?? target.email} admin access as ${roleName}`,
    targetType: "user",
    targetId: input.userId,
  });

  revalidatePath("/superadmin/roles");
  revalidatePath("/superadmin/users");
  return { ok: true };
}

/**
 * Take admin access away.
 *
 * Clears the role as well as the flag. Leaving a role behind on a revoked
 * account means a later re-grant silently restores permissions nobody chose
 * this time round.
 */
export async function removeAdmin(userId: string): Promise<RoleResult> {
  const admin = await requirePlatform("platform.roles.manage");
  if (!(await canPlatform("platform.users.manage")))
    return { ok: false, error: "You cannot change admin access." };
  if (!z.string().min(1).safeParse(userId).success)
    return { ok: false, error: "Invalid id" };
  // The same reason assignRole refuses: the way back is the database.
  if (userId === admin.id)
    return { ok: false, error: "You can't remove your own admin access." };

  const [target] = await db
    .select({ name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) return { ok: false, error: "That account no longer exists." };
  if (!target.isSuperAdmin)
    return { ok: false, error: "They do not have admin access." };

  await db
    .update(user)
    .set({ isSuperAdmin: false, platformRoleId: null, updatedAt: new Date() })
    .where(eq(user.id, userId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "revoke_superadmin",
    summary: `Removed admin access from ${target.name ?? target.email}`,
    targetType: "user",
    targetId: userId,
  });

  revalidatePath("/superadmin/roles");
  revalidatePath("/superadmin/users");
  return { ok: true };
}
