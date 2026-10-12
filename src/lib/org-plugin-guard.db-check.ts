/**
 * Database-backed checks for the organization-plugin guard's team-size rule.
 * Run with `pnpm test:db`.
 *
 * `resend: true` used to skip the plan's team size on the flag alone. The
 * plugin re-sends only when a live invitation to that address exists and
 * otherwise CREATES one, so `{ email: <new>, resend: true }` invited past the
 * limit. And a superadmin's temp seat must never count as a team member.
 *
 * Fixtures: one "zzcheck-" church on the growth plan and "zzcheck-" users,
 * removed by id at the end (the church cascades staff and invitations).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, invitation, staff, user } from "@/db/schema";
import { teamLimitFor } from "@/lib/entitlements";
import { guardTeamCall } from "@/lib/org-plugin-guard";

const STAMP = Date.now().toString(36);
const CHURCH_ID = `zzcheck-guard-${STAMP}`;
const OWNER = `zzcheck-guard-owner-${STAMP}`;
const TEMP = `zzcheck-guard-temp-${STAMP}`;
const LIMIT = teamLimitFor("growth");
const userIds: string[] = [OWNER, TEMP];
const KNOWN_EMAIL = `zzcheck-known-${STAMP}@example.invalid`;

async function addUser(id: string) {
  await db.insert(user).values({ id, name: id, email: `${id}@example.invalid` });
}

async function refusal(p: Promise<void>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { message?: string; body?: unknown }) =>
      `${e?.message ?? ""} ${JSON.stringify(e?.body ?? {})}`,
  );
}

const invite = (extra: { resend?: boolean; email?: string } = {}) =>
  guardTeamCall({
    path: "/organization/invite-member",
    userId: OWNER,
    churchId: CHURCH_ID,
    ...extra,
  });

beforeAll(async () => {
  await db.insert(church).values({
    id: CHURCH_ID,
    name: `Guard Check ${STAMP}`,
    slug: CHURCH_ID,
    currency: "NGN",
    plan: "growth",
  });
  await addUser(OWNER);
  await addUser(TEMP);
  await db.insert(staff).values([
    { id: `${OWNER}-staff`, organizationId: CHURCH_ID, userId: OWNER, role: "owner" },
    // A superadmin acting as the church. Not a seat.
    { id: `${TEMP}-staff`, organizationId: CHURCH_ID, userId: TEMP, role: "owner", temp: true },
  ]);
});

afterAll(async () => {
  await db.delete(church).where(eq(church.id, CHURCH_ID));
  await db.delete(user).where(inArray(user.id, userIds));
});

describe.skipIf(LIMIT === null || LIMIT < 2)("the plan's team size at the plugin's door", () => {
  it("does not count a superadmin's temp seat", async () => {
    // Real seats up to one below the limit; the temp row would make it full.
    for (let i = 1; i < (LIMIT ?? 0) - 1; i++) {
      const id = `zzcheck-guard-s${i}-${STAMP}`;
      userIds.push(id);
      await addUser(id);
      await db.insert(staff).values({
        id: `${id}-staff`,
        organizationId: CHURCH_ID,
        userId: id,
        role: "member",
      });
    }
    expect(await refusal(invite({ email: `zzcheck-new0-${STAMP}@example.invalid` }))).toBeNull();
  });

  it("refuses a new invitation dressed up as a resend once the team is full", async () => {
    const id = `zzcheck-guard-last-${STAMP}`;
    userIds.push(id);
    await addUser(id);
    await db.insert(staff).values({
      id: `${id}-staff`,
      organizationId: CHURCH_ID,
      userId: id,
      role: "member",
    });

    expect(await refusal(invite({ email: `zzcheck-new1-${STAMP}@example.invalid` }))).toMatch(
      /FI_TEAM_FULL|plan covers/,
    );
    expect(
      await refusal(invite({ resend: true, email: `zzcheck-new2-${STAMP}@example.invalid` })),
    ).toMatch(/FI_TEAM_FULL|plan covers/);
  });

  it("lets a genuine resend through: the same seat, not a new one", async () => {
    await db.insert(invitation).values({
      id: `zzcheck-inv-${STAMP}`,
      organizationId: CHURCH_ID,
      email: KNOWN_EMAIL,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: OWNER,
    });
    expect(
      await refusal(invite({ resend: true, email: KNOWN_EMAIL.toUpperCase() })),
    ).toBeNull();
  });

  it("does not treat an expired invitation as something to resend", async () => {
    await db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitation.id, `zzcheck-inv-${STAMP}`));
    expect(await refusal(invite({ resend: true, email: KNOWN_EMAIL }))).toMatch(
      /FI_TEAM_FULL|plan covers/,
    );
  });
});
