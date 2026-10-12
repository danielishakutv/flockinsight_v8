/**
 * Database-backed checks for church roles and the org role copied from them.
 * Run with `pnpm test:db`.
 *
 * `staff-permissions.test.ts` holds the policy with no database. What only a
 * real Postgres can show is the part that went wrong: `staff.role_id` is
 * `on delete set null`, so deleting a role used to leave its holders as
 * "admin with no role" — the legacy full-access fallback — while the audit
 * line said "dropped to the basics". This deletes a role the way
 * settings/roles/actions.ts now does and reads access back.
 *
 * Fixtures: one "zzcheck-" church and three "zzcheck-" users, removed by id at
 * the end (the church cascades its roles, staff rows, members and
 * invitations; an invitation cascades its staff_invite row).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, invitation, member, role, staff, staffInvite, user } from "@/db/schema";
import { ALL_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS } from "@/lib/permissions-catalog";
import { deleteChurchRole, detachRoleHolders, syncRoleHolders } from "@/lib/role-sync";
import { loadStaffAccess } from "@/lib/staff-permissions";

const STAMP = Date.now().toString(36);
const CHURCH_ID = `zzcheck-roles-${STAMP}`;
const SECRETARY = `zzcheck-sec-${STAMP}`;
const LEGACY = `zzcheck-legacy-${STAMP}`;
const RACER = `zzcheck-racer-${STAMP}`;

let secretaryRoleId = "";

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH_ID,
    name: `Roles Check ${STAMP}`,
    slug: CHURCH_ID,
    currency: "NGN",
  });
  await db.insert(user).values([
    { id: SECRETARY, name: "Sec Check", email: `${SECRETARY}@example.invalid` },
    { id: LEGACY, name: "Legacy Check", email: `${LEGACY}@example.invalid` },
    { id: RACER, name: "Racer Check", email: `${RACER}@example.invalid` },
  ]);
  const [r] = await db
    .insert(role)
    .values({
      churchId: CHURCH_ID,
      name: "Secretary",
      permissions: ["members.view", "team.manage"],
    })
    .returning({ id: role.id });
  secretaryRoleId = r.id;
  await db.insert(staff).values([
    // What assignRole writes for a role carrying team.manage.
    {
      id: `${SECRETARY}-staff`,
      organizationId: CHURCH_ID,
      userId: SECRETARY,
      role: "admin",
      roleId: secretaryRoleId,
    },
    // A genuine legacy admin: invited as admin before church roles existed.
    {
      id: `${LEGACY}-staff`,
      organizationId: CHURCH_ID,
      userId: LEGACY,
      role: "admin",
      roleId: null,
    },
  ]);
});

afterAll(async () => {
  await db.delete(church).where(eq(church.id, CHURCH_ID));
  await db.delete(user).where(inArray(user.id, [SECRETARY, LEGACY, RACER]));
});

async function makeRole(name: string, permissions: string[]): Promise<string> {
  const [r] = await db
    .insert(role)
    .values({ churchId: CHURCH_ID, name: `${name} ${STAMP}`, permissions })
    .returning({ id: role.id });
  return r.id;
}

/** A pending invitation raised for a role, as inviteMemberAsStaff writes it. */
async function inviteOnto(roleId: string, orgRole: "admin" | "member"): Promise<string> {
  const [m] = await db
    .insert(member)
    .values({ churchId: CHURCH_ID, firstName: "Invitee", lastName: STAMP })
    .returning({ id: member.id });
  const invitationId = `zzcheck-inv-${crypto.randomUUID()}`;
  await db.insert(invitation).values({
    id: invitationId,
    organizationId: CHURCH_ID,
    email: `${invitationId}@example.invalid`,
    role: orgRole,
    status: "pending",
    expiresAt: new Date(Date.now() + 86_400_000),
    inviterId: SECRETARY,
  });
  await db.insert(staffInvite).values({ invitationId, memberId: m.id, roleId });
  return invitationId;
}

async function invitationRole(id: string) {
  const [row] = await db
    .select({ role: invitation.role })
    .from(invitation)
    .where(eq(invitation.id, id));
  return row?.role;
}

async function orgRoleOf(userId: string) {
  const [s] = await db
    .select({ role: staff.role, roleId: staff.roleId })
    .from(staff)
    .where(and(eq(staff.organizationId, CHURCH_ID), eq(staff.userId, userId)));
  return s;
}

describe("editing a role keeps its holders' org role in step", () => {
  it("removing team.manage takes the org-plugin admin away", async () => {
    await db.transaction(async (tx) => {
      await tx
        .update(role)
        .set({ permissions: ["members.view"] })
        .where(eq(role.id, secretaryRoleId));
      await syncRoleHolders(tx, CHURCH_ID, secretaryRoleId, ["members.view"]);
    });
    expect((await orgRoleOf(SECRETARY)).role).toBe("member");
    const access = await loadStaffAccess(SECRETARY, CHURCH_ID);
    expect([...access.perms]).toEqual(["members.view"]);
  });

  it("adding team.manage back grants it, so the plugin accepts their invites", async () => {
    const perms = ["members.view", "team.manage"];
    await db.transaction(async (tx) => {
      await tx.update(role).set({ permissions: perms }).where(eq(role.id, secretaryRoleId));
      await syncRoleHolders(tx, CHURCH_ID, secretaryRoleId, perms);
    });
    expect((await orgRoleOf(SECRETARY)).role).toBe("admin");
  });
});

describe("deleting a role", () => {
  it("drops its holders to the basics, never to everything", async () => {
    await db.transaction(async (tx) => {
      await detachRoleHolders(tx, CHURCH_ID, secretaryRoleId);
      await tx.delete(role).where(eq(role.id, secretaryRoleId));
    });

    const row = await orgRoleOf(SECRETARY);
    expect(row).toEqual({ role: "member", roleId: null });

    const access = await loadStaffAccess(SECRETARY, CHURCH_ID);
    expect(access.isOwner).toBe(false);
    expect([...access.perms].sort()).toEqual([...MEMBER_DEFAULT_PERMISSIONS].sort());
    expect(access.perms.has("giving.view")).toBe(false);
    expect(access.perms.has("team.manage")).toBe(false);
  });

  it("leaves a genuine legacy admin alone", async () => {
    const access = await loadStaffAccess(LEGACY, CHURCH_ID);
    expect(access.perms.size).toBe(ALL_PERMISSIONS.length);
  });
});

describe("pending invitations follow their role", () => {
  it("editing a role re-derives the org role its invitees will arrive with", async () => {
    const id = await makeRole("Usher", ["members.view", "team.manage"]);
    const inv = await inviteOnto(id, "admin");
    await db.transaction(async (tx) => {
      await tx.update(role).set({ permissions: ["members.view"] }).where(eq(role.id, id));
      await syncRoleHolders(tx, CHURCH_ID, id, ["members.view"]);
    });
    expect(await invitationRole(inv)).toBe("member");
  });

  it("deleting a role drops its pending invitations to member, not admin-with-no-role", async () => {
    const id = await makeRole("Clerk", ["members.view", "team.manage"]);
    const inv = await inviteOnto(id, "admin");
    expect(await deleteChurchRole(CHURCH_ID, id)).toBe(true);
    expect(await invitationRole(inv)).toBe("member");
    // The side row survives with no role: accepting it now lands on the basics.
    const [side] = await db
      .select({ roleId: staffInvite.roleId })
      .from(staffInvite)
      .where(eq(staffInvite.invitationId, inv));
    expect(side).toEqual({ roleId: null });
  });

  it("refuses the system role", async () => {
    const [sys] = await db
      .insert(role)
      .values({
        churchId: CHURCH_ID,
        name: `System ${STAMP}`,
        permissions: [...ALL_PERMISSIONS],
        isSystem: true,
      })
      .returning({ id: role.id });
    expect(await deleteChurchRole(CHURCH_ID, sys.id)).toBe(false);
    const [still] = await db.select({ id: role.id }).from(role).where(eq(role.id, sys.id));
    expect(still?.id).toBe(sys.id);
  });
});

describe("deleting a role while somebody is being put on it", () => {
  /*
   * Two deliberately interleaved transactions over ONE contested staff row
   * (AGENTS.md). A holds an uncommitted assignment to the role, exactly as
   * assignRole's UPDATE would; the delete starts while A is open. Without the
   * lock the delete's detach cannot see A's uncommitted row, A then commits,
   * and the FK's set-null leaves RACER as "admin" with no role: everything.
   */
  it("waits for the assignment, then detaches it", async () => {
    const id = await makeRole("Steward", ["members.view", "team.manage"]);
    const racerStaff = `${RACER}-staff`;
    await db.insert(staff).values({
      id: racerStaff,
      organizationId: CHURCH_ID,
      userId: RACER,
      role: "member",
      roleId: null,
    });

    let markUpdated!: () => void;
    const updated = new Promise<void>((r) => (markUpdated = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const assign = db.transaction(async (tx) => {
      await tx
        .update(staff)
        .set({ roleId: id, role: "admin" })
        .where(eq(staff.id, racerStaff));
      markUpdated();
      await gate;
    });

    await updated;
    let deleteFinished = false;
    const del = deleteChurchRole(CHURCH_ID, id).then((v) => {
      deleteFinished = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 400));
    // Blocked on the role lock behind A's foreign-key check, not racing past it.
    expect(deleteFinished).toBe(false);

    release();
    await assign;
    expect(await del).toBe(true);

    expect(await orgRoleOf(RACER)).toEqual({ role: "member", roleId: null });
    const access = await loadStaffAccess(RACER, CHURCH_ID);
    expect(access.perms.has("giving.view")).toBe(false);
    expect(access.perms.has("team.manage")).toBe(false);
  });
});

describe("a temp seat is not membership", () => {
  it("grants nothing once impersonation has ended", async () => {
    const tempUser = `zzcheck-temp-${STAMP}`;
    await db.insert(user).values({
      id: tempUser,
      name: "Temp Check",
      email: `${tempUser}@example.invalid`,
    });
    try {
      await db.insert(staff).values({
        id: `${tempUser}-staff`,
        organizationId: CHURCH_ID,
        userId: tempUser,
        role: "owner",
        temp: true,
      });
      const access = await loadStaffAccess(tempUser, CHURCH_ID);
      expect(access.isOwner).toBe(false);
      expect(access.perms.size).toBe(0);
    } finally {
      await db.delete(user).where(eq(user.id, tempUser));
    }
  });
});
