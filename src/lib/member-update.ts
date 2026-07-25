import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  group,
  groupMembership,
  member,
  memberSignup,
  type MemberSignup,
} from "@/db/schema";
/* ============================================================
 * Personal self-update link — a per-member, unguessable link (/m/<token>)
 * that opens the member's own details pre-filled, so they can review, correct
 * and extend them (including adding children) without an account. The token is
 * the credential (the church chooses who to share it with) and can be
 * regenerated to revoke old links.
 * ========================================================== */

/** A fresh, URL-safe token (32 chars). */
export function newUpdateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Return the member's update token, generating (and saving) one if absent. */
export async function ensureMemberUpdateToken(
  churchId: string,
  memberId: string,
): Promise<string | null> {
  const [m] = await db
    .select({ token: member.updateToken })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.churchId, churchId)))
    .limit(1);
  if (!m) return null;
  if (m.token) return m.token;

  // Generate, retrying on the (astronomically unlikely) unique collision.
  for (let i = 0; i < 5; i++) {
    const token = newUpdateToken();
    try {
      await db
        .update(member)
        .set({ updateToken: token })
        .where(and(eq(member.id, memberId), eq(member.churchId, churchId)));
      return token;
    } catch {
      /* collision — try another */
    }
  }
  return null;
}

/** Consume the token after a successful update so the link works only once. */
export async function consumeMemberUpdateToken(
  churchId: string,
  memberId: string,
): Promise<void> {
  await db
    .update(member)
    .set({ updateToken: null })
    .where(and(eq(member.id, memberId), eq(member.churchId, churchId)));
}

/** Issue a brand-new token (invalidates any previously shared link). */
export async function regenerateMemberUpdateToken(
  churchId: string,
  memberId: string,
): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const token = newUpdateToken();
    try {
      const [row] = await db
        .update(member)
        .set({ updateToken: token })
        .where(and(eq(member.id, memberId), eq(member.churchId, churchId)))
        .returning({ id: member.id });
      if (!row) return null;
      return token;
    } catch {
      /* collision — try another */
    }
  }
  return null;
}

/** Sensible collect-flags when a church hasn't customised its sign-up config. */
const DEFAULT_COLLECT = {
  collectBirthday: true,
  collectAddress: true,
  collectAnniversary: true,
  collectChildren: true,
  allowGroupSelect: true,
  requireVerification: false,
  successMessage: "Thank you! Your details have been updated.",
} as const;

export type MemberUpdatePrefill = {
  firstName: string;
  lastName: string;
  gender: "male" | "female" | "";
  phone: string;
  email: string;
  dateOfBirth: string;
  weddingDate: string;
  address: string;
  city: string;
  state: string;
};

export type MemberUpdateData = {
  token: string;
  church: { id: string; name: string; logo: string | null; theme: string };
  config: {
    collectBirthday: boolean;
    collectAddress: boolean;
    collectAnniversary: boolean;
    collectChildren: boolean;
    allowGroupSelect: boolean;
    requireVerification: boolean;
    successMessage: string;
  };
  member: MemberUpdatePrefill;
  groups: { id: string; name: string }[];
  myGroupIds: string[];
  children: { id: string; name: string; relationship: string | null }[];
  signup: MemberSignup | null;
};

/** Everything the /m/<token> page needs. Null when the token is unknown. */
export async function getMemberByUpdateToken(
  token: string,
): Promise<MemberUpdateData | null> {
  if (!token || token.length < 16) return null;

  const [m] = await db
    .select({
      id: member.id,
      churchId: member.churchId,
      firstName: member.firstName,
      lastName: member.lastName,
      gender: member.gender,
      phone: member.phone,
      email: member.email,
      dateOfBirth: member.dateOfBirth,
      weddingDate: member.weddingDate,
      address: member.address,
      house: member.house,
      street: member.street,
      city: member.city,
      state: member.state,
    })
    .from(member)
    .where(eq(member.updateToken, token))
    .limit(1);
  if (!m) return null;

  const [c] = await db
    .select({
      id: church.id,
      name: church.name,
      logo: church.logo,
      theme: church.theme,
    })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);
  if (!c) return null;

  const [signup] = await db
    .select()
    .from(memberSignup)
    .where(eq(memberSignup.churchId, m.churchId))
    .limit(1);
  const config = signup
    ? {
        collectBirthday: signup.collectBirthday,
        collectAddress: signup.collectAddress,
        collectAnniversary: signup.collectAnniversary,
        collectChildren: signup.collectChildren,
        allowGroupSelect: signup.allowGroupSelect,
        requireVerification: signup.requireUpdateOtp,
        successMessage: signup.successMessage,
      }
    : { ...DEFAULT_COLLECT };

  const [groups, myGroups, children] = await Promise.all([
    config.allowGroupSelect
      ? db
          .select({ id: group.id, name: group.name })
          .from(group)
          .where(and(eq(group.churchId, m.churchId), eq(group.isActive, true)))
          .orderBy(asc(group.name))
      : Promise.resolve([]),
    db
      .select({ groupId: groupMembership.groupId })
      .from(groupMembership)
      .where(eq(groupMembership.memberId, m.id)),
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        relationship: member.relationship,
      })
      .from(member)
      .where(and(eq(member.guardianId, m.id), eq(member.churchId, m.churchId)))
      .orderBy(asc(member.firstName)),
  ]);

  return {
    token,
    church: c,
    config,
    member: {
      firstName: m.firstName,
      lastName: m.lastName ?? "",
      gender: m.gender ?? "",
      phone: m.phone ?? "",
      email: m.email ?? "",
      // A year-less stored birthday round-trips fine through the picker.
      dateOfBirth: m.dateOfBirth ?? "",
      weddingDate: m.weddingDate ?? "",
      address: m.address ?? [m.house, m.street].filter(Boolean).join(" "),
      city: m.city ?? "",
      state: m.state ?? "",
    },
    groups,
    myGroupIds: myGroups.map((g) => g.groupId),
    children: children.map((ch) => ({
      id: ch.id,
      name: [ch.firstName, ch.lastName].filter(Boolean).join(" "),
      relationship: ch.relationship,
    })),
    signup: signup ?? null,
  };
}
