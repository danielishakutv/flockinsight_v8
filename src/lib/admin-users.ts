import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { account, user } from "@/db/schema";

/** A readable temporary password, e.g. "Flock-3f9a2c". */
export function generateTempPassword(): string {
  return `Flock-${randomBytes(4).toString("hex")}`;
}

/** Hash a password using Better Auth's configured hasher. */
export async function hashPassword(password: string): Promise<string> {
  const ctx = await auth.$context;
  return ctx.password.hash(password);
}

/**
 * Set a user's credential password to `newPassword`. Returns false if the user
 * has no email/password (credential) account to update.
 */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<boolean> {
  const hash = await hashPassword(newPassword);
  const updated = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  return updated.length > 0;
}

/**
 * Admin reset: set a generated temp password, force a change on next login,
 * and ensure the account can sign in (verified). Returns the temp password.
 */
export async function adminResetPassword(
  userId: string,
): Promise<{ ok: true; tempPassword: string } | { ok: false; error: string }> {
  const temp = generateTempPassword();
  const ok = await setUserPassword(userId, temp);
  if (!ok)
    return {
      ok: false,
      error: "This account signs in another way (no password to reset).",
    };
  await db
    .update(user)
    .set({ mustChangePassword: true, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId));
  return { ok: true, tempPassword: temp };
}
