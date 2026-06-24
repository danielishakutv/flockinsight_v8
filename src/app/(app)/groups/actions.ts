"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { group, groupMembership, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const GROUP_TYPES = [
  "ministry",
  "department",
  "group",
  "cell",
  "committee",
  "class",
] as const;

const groupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(GROUP_TYPES),
  description: optText(1000),
  // Optional initial leader, only used when first creating the group.
  leaderId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  meetingDay: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(6).nullable(),
  ),
  meetingTime: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Invalid time")
      .nullable(),
  ),
  isActive: z.boolean().default(true),
});

export type GroupInput = z.input<typeof groupSchema>;

/** Confirm a member belongs to the active church. */
async function memberIdsInChurch(ids: string[], churchId: string) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.churchId, churchId), inArray(member.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/** Confirm a group belongs to the active church; returns its id or null. */
async function groupInChurch(groupId: string, churchId: string) {
  const [g] = await db
    .select({ id: group.id })
    .from(group)
    .where(and(eq(group.id, groupId), eq(group.churchId, churchId)))
    .limit(1);
  return g?.id ?? null;
}

export async function saveGroup(input: GroupInput): Promise<ActionResult> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;
  const { church, user } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };

  // A leader, if given, must be a member of this church.
  if (d.leaderId) {
    const ok = await memberIdsInChurch([d.leaderId], church.id);
    if (!ok.has(d.leaderId)) {
      return { ok: false, error: "That leader isn't in your congregation." };
    }
  }

  const fields = {
    name: d.name,
    type: d.type,
    description: d.description,
    meetingDay: d.meetingDay,
    meetingTime: d.meetingTime,
    isActive: d.isActive,
  };

  try {
    if (d.id) {
      const [row] = await db
        .update(group)
        .set(fields)
        .where(and(eq(group.id, d.id), eq(group.churchId, church.id)))
        .returning({ id: group.id });
      if (!row) return { ok: false, error: "Group not found." };
      revalidatePath("/groups");
      revalidatePath(`/groups/${row.id}`);
      return { ok: true, id: row.id };
    }

    const [row] = await db
      .insert(group)
      .values({ churchId: church.id, ...fields, createdBy: user.id })
      .returning({ id: group.id });

    // If an initial leader was named, add them as a member and flag them.
    if (d.leaderId) {
      await db
        .insert(groupMembership)
        .values({
          groupId: row.id,
          memberId: d.leaderId,
          isLeader: true,
          role: "Leader",
        })
        .onConflictDoNothing();
    }

    revalidatePath("/groups");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("saveGroup failed", e);
    return { ok: false, error: "Could not save group." };
  }
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const { church } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };
  try {
    const [row] = await db
      .delete(group)
      .where(and(eq(group.id, id), eq(group.churchId, church.id)))
      .returning({ id: group.id });
    if (!row) return { ok: false, error: "Group not found." };
    revalidatePath("/groups");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteGroup failed", e);
    return { ok: false, error: "Could not delete group." };
  }
}

export async function addMembersToGroup(
  groupId: string,
  memberIds: string[],
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(groupId).success)
    return { ok: false, error: "Invalid id" };
  const ids = [...new Set(memberIds)].filter(
    (id) => z.string().uuid().safeParse(id).success,
  );
  if (ids.length === 0) return { ok: false, error: "No members selected." };

  const { church } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };
  const gid = await groupInChurch(groupId, church.id);
  if (!gid) return { ok: false, error: "Group not found." };

  // Only add people who actually belong to this church.
  const valid = await memberIdsInChurch(ids, church.id);
  const toAdd = ids.filter((id) => valid.has(id));
  if (toAdd.length === 0)
    return { ok: false, error: "None of those people are in your congregation." };

  try {
    await db
      .insert(groupMembership)
      .values(toAdd.map((memberId) => ({ groupId, memberId })))
      .onConflictDoNothing();
    revalidatePath(`/groups/${groupId}`);
    revalidatePath("/groups");
    return { ok: true, id: groupId };
  } catch (e) {
    console.error("addMembersToGroup failed", e);
    return { ok: false, error: "Could not add members." };
  }
}

export async function removeMemberFromGroup(
  groupId: string,
  memberId: string,
): Promise<ActionResult> {
  if (
    !z.string().uuid().safeParse(groupId).success ||
    !z.string().uuid().safeParse(memberId).success
  )
    return { ok: false, error: "Invalid id" };

  const { church } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };
  const gid = await groupInChurch(groupId, church.id);
  if (!gid) return { ok: false, error: "Group not found." };

  try {
    await db
      .delete(groupMembership)
      .where(
        and(
          eq(groupMembership.groupId, groupId),
          eq(groupMembership.memberId, memberId),
        ),
      );
    revalidatePath(`/groups/${groupId}`);
    revalidatePath("/groups");
    return { ok: true, id: groupId };
  } catch (e) {
    console.error("removeMemberFromGroup failed", e);
    return { ok: false, error: "Could not remove member." };
  }
}

export async function setMembershipLeader(
  groupId: string,
  memberId: string,
  isLeader: boolean,
): Promise<ActionResult> {
  if (
    !z.string().uuid().safeParse(groupId).success ||
    !z.string().uuid().safeParse(memberId).success
  )
    return { ok: false, error: "Invalid id" };

  const { church } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };
  const gid = await groupInChurch(groupId, church.id);
  if (!gid) return { ok: false, error: "Group not found." };

  try {
    await db
      .update(groupMembership)
      .set({ isLeader })
      .where(
        and(
          eq(groupMembership.groupId, groupId),
          eq(groupMembership.memberId, memberId),
        ),
      );
    revalidatePath(`/groups/${groupId}`);
    revalidatePath("/groups");
    return { ok: true, id: groupId };
  } catch (e) {
    console.error("setMembershipLeader failed", e);
    return { ok: false, error: "Could not update leader." };
  }
}

export async function setMembershipRole(
  groupId: string,
  memberId: string,
  role: string | null,
): Promise<ActionResult> {
  if (
    !z.string().uuid().safeParse(groupId).success ||
    !z.string().uuid().safeParse(memberId).success
  )
    return { ok: false, error: "Invalid id" };

  const cleanRole =
    typeof role === "string" && role.trim() ? role.trim().slice(0, 80) : null;

  const { church } = await requireChurch();
  if (!(await can("groups.manage")))
    return { ok: false, error: "You don't have permission to manage groups." };
  const gid = await groupInChurch(groupId, church.id);
  if (!gid) return { ok: false, error: "Group not found." };

  try {
    await db
      .update(groupMembership)
      .set({ role: cleanRole })
      .where(
        and(
          eq(groupMembership.groupId, groupId),
          eq(groupMembership.memberId, memberId),
        ),
      );
    revalidatePath(`/groups/${groupId}`);
    return { ok: true, id: groupId };
  } catch (e) {
    console.error("setMembershipRole failed", e);
    return { ok: false, error: "Could not update role." };
  }
}
