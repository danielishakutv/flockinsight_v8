"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { role, staff } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { ALL_PERMISSIONS, can } from "@/lib/permissions";
import { betterAuthRoleFor } from "@/lib/staff-access";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PERM_SET = new Set(ALL_PERMISSIONS);

const roleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(300).nullable(),
  ),
  permissions: z
    .array(z.string())
    .transform((arr) => [...new Set(arr)].filter((p) => PERM_SET.has(p))),
});

async function guard() {
  const ctx = await requireChurch();
  if (!(await can("team.manage"))) {
    return { ctx, error: "You don't have permission to manage roles." as const };
  }
  return { ctx, error: null };
}

export async function createRole(input: {
  name: string;
  description: string | null;
  permissions: string[];
}): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  try {
    await db.insert(role).values({
      churchId: ctx.church.id,
      name: parsed.data.name,
      description: parsed.data.description,
      permissions: parsed.data.permissions,
    });
  } catch {
    return { ok: false, error: "A role with that name already exists." };
  }
  revalidatePath("/settings/roles");
  return { ok: true };
}

export async function updateRole(input: {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(input.id).success)
    return { ok: false, error: "Invalid id" };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  const [existing] = await db
    .select({ isSystem: role.isSystem })
    .from(role)
    .where(and(eq(role.id, input.id), eq(role.churchId, ctx.church.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Role not found." };
  if (existing.isSystem)
    return { ok: false, error: "The Owner role can't be changed." };

  try {
    await db
      .update(role)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        permissions: parsed.data.permissions,
      })
      .where(and(eq(role.id, input.id), eq(role.churchId, ctx.church.id)));
  } catch {
    return { ok: false, error: "A role with that name already exists." };
  }
  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  const [existing] = await db
    .select({ isSystem: role.isSystem })
    .from(role)
    .where(and(eq(role.id, id), eq(role.churchId, ctx.church.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Role not found." };
  if (existing.isSystem)
    return { ok: false, error: "The Owner role can't be deleted." };

  // Staff keep their membership; their roleId is cleared (FK on delete).
  await db.delete(role).where(and(eq(role.id, id), eq(role.churchId, ctx.church.id)));
  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ok: true };
}

/** Assign a church role to a team member (or clear it with null). */
export async function assignRole(
  staffId: string,
  roleId: string | null,
): Promise<ActionResult> {
  const { ctx, error } = await guard();
  if (error) return { ok: false, error };

  const [member] = await db
    .select({ id: staff.id, role: staff.role, userId: staff.userId })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.organizationId, ctx.church.id)))
    .limit(1);
  if (!member) return { ok: false, error: "Team member not found." };
  // Owner guard stays first, so the owner can never be demoted by this action.
  if (member.role === "owner")
    return { ok: false, error: "The owner's access can't be changed." };

  let permissions: string[] | null = null;
  if (roleId) {
    const [r] = await db
      .select({ isSystem: role.isSystem, permissions: role.permissions })
      .from(role)
      .where(and(eq(role.id, roleId), eq(role.churchId, ctx.church.id)))
      .limit(1);
    if (!r) return { ok: false, error: "Role not found." };
    if (r.isSystem)
      return { ok: false, error: "The Owner role can't be assigned." };
    permissions = r.permissions ?? [];
  }

  // Now that this also writes staff.role, someone could demote themselves out
  // of team management entirely — recoverable only by the owner. Refuse it.
  if (
    permissions !== null &&
    member.userId === ctx.user.id &&
    betterAuthRoleFor(permissions) !== "admin"
  ) {
    return {
      ok: false,
      error:
        "You can't remove your own team management access — ask the church owner to change your role.",
    };
  }

  // The church role is the source of truth for both systems: a role granting
  // "Manage team" must also carry the Better Auth org role, or the Team page
  // lets them in and Better Auth then rejects their invite.
  //
  // Clearing a role deliberately leaves staff.role alone — writing "member"
  // would silently demote a legacy admin who has no church role and depends on
  // the full-access fallback in lib/permissions.ts.
  await db
    .update(staff)
    .set(
      permissions === null
        ? { roleId: null }
        : { roleId, role: betterAuthRoleFor(permissions) },
    )
    .where(and(eq(staff.id, staffId), eq(staff.organizationId, ctx.church.id)));
  revalidatePath("/settings/team");
  return { ok: true };
}
