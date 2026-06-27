"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { church, invitation, staff, user } from "@/db/schema";
import { getSession } from "@/lib/session";
import { notifyChurchManagers } from "@/lib/notifications";
import { ensureMemberForUser } from "@/lib/member-link";

type LoadedInvitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  organizationId: string;
  churchName: string | null;
};

async function loadInvitation(id: string): Promise<LoadedInvitation | null> {
  const [inv] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      churchName: church.name,
    })
    .from(invitation)
    .leftJoin(church, eq(church.id, invitation.organizationId))
    .where(eq(invitation.id, id))
    .limit(1);
  return inv ?? null;
}

function isExpired(inv: LoadedInvitation): boolean {
  return new Date(inv.expiresAt).getTime() < Date.now();
}

async function isMember(organizationId: string, userId: string) {
  const [m] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(eq(staff.organizationId, organizationId), eq(staff.userId, userId)),
    )
    .limit(1);
  return !!m;
}

async function joinChurch(inv: LoadedInvitation, userId: string) {
  const wasMember = await isMember(inv.organizationId, userId);
  if (!wasMember) {
    await db.insert(staff).values({
      id: crypto.randomUUID(),
      organizationId: inv.organizationId,
      userId,
      role: inv.role ?? "member",
    });
  }
  await db
    .update(invitation)
    .set({ status: "accepted" })
    .where(eq(invitation.id, inv.id));

  // Link (or create) this person's member profile so we don't duplicate them.
  if (!wasMember) await ensureMemberForUser(inv.organizationId, userId);

  // Notify the church's managers that someone joined (in-app only).
  if (!wasMember) {
    const [u] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    await notifyChurchManagers({
      churchId: inv.organizationId,
      title: "New team member joined",
      body: `${u?.name ?? "Someone"} accepted the invitation and joined ${inv.churchName ?? "your church"}.`,
      linkUrl: "/settings/team",
      excludeUserId: userId,
    });
  }
}

export type AcceptResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: string; code?: "EXISTS" | "WRONG_USER" };

/** Accept an invitation for the currently signed-in (matching) user. */
export async function acceptInvite(invitationId: string): Promise<AcceptResult> {
  const data = await getSession();
  if (!data?.user) {
    return { ok: false, error: "Please log in to accept this invitation." };
  }
  const inv = await loadInvitation(invitationId);
  if (!inv) return { ok: false, error: "This invitation is no longer valid." };

  const already = await isMember(inv.organizationId, data.user.id);
  const emailMatches =
    data.user.email.toLowerCase() === inv.email.toLowerCase();

  if (!already) {
    if (!emailMatches) {
      return {
        ok: false,
        code: "WRONG_USER",
        error: `This invitation was sent to ${inv.email}. Log in with that email to accept.`,
      };
    }
    if (inv.status !== "pending") {
      return { ok: false, error: "This invitation has already been used." };
    }
    if (isExpired(inv)) {
      return { ok: false, error: "This invitation has expired." };
    }
    await joinChurch(inv, data.user.id);
  }

  return { ok: true, organizationId: inv.organizationId };
}

/**
 * For an invitee with no account: create a pre-verified account (the emailed
 * invite link proves ownership), join the church, and mark the invite
 * accepted. The client then signs them in.
 */
export async function joinAsNewUser(
  invitationId: string,
  name: string,
  password: string,
): Promise<AcceptResult & { email?: string }> {
  const inv = await loadInvitation(invitationId);
  if (!inv) return { ok: false, error: "This invitation is no longer valid." };
  if (inv.status !== "pending") {
    return { ok: false, error: "This invitation has already been used." };
  }
  if (isExpired(inv)) {
    return { ok: false, error: "This invitation has expired." };
  }

  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) return { ok: false, error: "Please enter your name." };
  if (typeof password !== "string" || password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, inv.email))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      code: "EXISTS",
      error: "An account already exists for this email. Please log in instead.",
    };
  }

  // Create the account (sendOnSignUp is off, so no verification email fires).
  let signUp;
  try {
    signUp = await auth.api.signUpEmail({
      body: { email: inv.email, password, name: cleanName },
      headers: await headers(),
    });
  } catch {
    return { ok: false, error: "Could not create your account." };
  }
  const userId = signUp?.user?.id;
  if (!userId) return { ok: false, error: "Could not create your account." };

  // Guard against Better Auth's anti-enumeration synthetic user.
  const [realUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!realUser) {
    return {
      ok: false,
      code: "EXISTS",
      error: "An account already exists for this email. Please log in instead.",
    };
  }

  try {
    // Pre-verify (the invite link is proof) so they can sign in immediately,
    // then join the church and consume the invitation.
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, userId));
    await joinChurch(inv, userId);
  } catch (e) {
    console.error("joinAsNewUser join failed", e);
    return { ok: false, error: "Could not finish joining the church." };
  }

  return { ok: true, organizationId: inv.organizationId, email: inv.email };
}
