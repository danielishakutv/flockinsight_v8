"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { church, staff, session as sessionTable, user } from "@/db/schema";
import { slugify, randomSuffix } from "@/lib/slug";
import { ensureMemberForUser } from "@/lib/member-link";
import { trialEndDate } from "@/lib/trial";

export type SignUpResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; error: string; needsOnboarding?: boolean };

function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const body = (e as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
    const msg = (e as { message?: string }).message;
    if (msg) return msg;
  }
  return fallback;
}

function isUniqueViolation(e: unknown): boolean {
  // Postgres unique_violation. Surfaces on the error or a nested cause.
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Create a church account in one server-side step.
 *
 * Why this lives on the server: when email verification is required,
 * `signUpEmail` intentionally returns no session (`token: null`) until the
 * user verifies. The old client flow then called `organization.create()`
 * with no session and got a 401 ("church setup failed"). Creating the church
 * here — tied directly to the new user — works whether or not a session
 * exists. After the user verifies and logs in, the session-create hook in
 * `auth.ts` auto-selects this church as their active tenant.
 */
export async function createChurchAccount(input: {
  churchName: string;
  name: string;
  email: string;
  password: string;
}): Promise<SignUpResult> {
  const churchName = input.churchName.trim();
  const name = input.name.trim();
  const email = input.email.trim();

  if (!churchName || !name || !email || !input.password) {
    return { ok: false, error: "Please fill in every field." };
  }

  // 1) Create the user account. With email verification enabled this does
  //    NOT sign the user in; it also fires the verification email.
  let signUp;
  try {
    signUp = await auth.api.signUpEmail({
      body: { email, password: input.password, name },
      headers: await headers(),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Could not create your account.") };
  }

  const userId = signUp?.user?.id;
  if (!userId) {
    return { ok: false, error: "Could not create your account." };
  }

  // Guard against Better Auth's anti-enumeration response: when the email is
  // already registered (and verification is on) it returns a *synthetic* user
  // whose id is not in the database. Don't create an orphan church for it.
  const [realUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!realUser) {
    return {
      ok: false,
      error: "That email is already registered. Please log in instead.",
    };
  }

  // 2) Create the church (organization) + owner membership, atomically, so a
  //    failure never leaves a church without its owner.
  const churchId = crypto.randomUUID();
  const base = slugify(churchName) || "church";
  let slug = base;

  for (let attempt = 0; ; attempt++) {
    try {
      await db.transaction(async (tx) => {
        // `handle` (public URL) defaults to the slug; the church can change it.
        await tx.insert(church).values({
          id: churchId,
          name: churchName,
          slug,
          handle: slug,
          // Start the "first 7 Sundays free" trial from today.
          trialEndsAt: trialEndDate(new Date()),
        });
        await tx.insert(staff).values({
          id: crypto.randomUUID(),
          organizationId: churchId,
          userId,
          role: "owner",
        });
      });
      break;
    } catch (e) {
      // Slug collision → retry a few times with a random suffix.
      if (isUniqueViolation(e) && attempt < 4) {
        slug = `${base}-${randomSuffix()}`;
        continue;
      }
      return {
        ok: false,
        error: "Account created, but church setup failed. You can finish setup now.",
        needsOnboarding: true,
      };
    }
  }

  // The owner is also a person in the congregation — create their member
  // profile so they aren't duplicated later.
  await ensureMemberForUser(churchId, userId);

  // 3) If sign-up created a session (verification disabled → auto sign-in),
  //    point it at the new church so the user lands in-context. When
  //    verification is required there is no session yet — the login hook
  //    handles it later.
  const updated = await db
    .update(sessionTable)
    .set({ activeOrganizationId: churchId })
    .where(eq(sessionTable.userId, userId))
    .returning({ id: sessionTable.id });

  const signedIn = updated.length > 0;

  // No session means email verification is required → send the link now
  // (global auto-send is off; the login page also offers a resend fallback).
  if (!signedIn) {
    try {
      await auth.api.sendVerificationEmail({
        body: { email },
        headers: await headers(),
      });
    } catch (e) {
      console.error("sendVerificationEmail (signup) failed", e);
    }
  }

  return { ok: true, signedIn };
}
