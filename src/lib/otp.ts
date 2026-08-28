import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpCode } from "@/db/schema";

/**
 * One-time codes (OTP) for verifying ownership of an email/phone before a
 * sensitive action. Codes are 6 digits, stored only as a salted SHA-256 hash,
 * expire quickly, and lock after too many wrong attempts.
 *
 * This is deliberately self-contained (a plain table + these helpers) and does
 * NOT touch Better Auth, so existing logins are unaffected.
 */

const CODE_TTL_MIN = 10; // codes are valid for 10 minutes
const MAX_ATTEMPTS = 5; // wrong guesses before a code is dead
const MAX_ACTIVE_PER_DEST = 3; // throttle: live codes per destination+purpose

function salt(): string {
  return process.env.BETTER_AUTH_SECRET || "flockinsight-otp-fallback-salt";
}

function hashCode(code: string): string {
  return createHash("sha256").update(`${code}:${salt()}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type IssueOtpInput = {
  churchId: string | null;
  purpose: string;
  channel: "email" | "sms";
  /** Normalised destination the code is sent to (lower-email / digits-phone). */
  destination: string;
  memberId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type IssueOtpResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string };

/**
 * Create + store a fresh code and return the plaintext (so the caller can
 * deliver it). Throttled per destination+purpose to prevent flooding.
 */
export async function issueOtp(input: IssueOtpInput): Promise<IssueOtpResult> {
  // Throttle: how many un-consumed, un-expired codes exist right now?
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpCode)
    .where(
      and(
        eq(otpCode.destination, input.destination),
        eq(otpCode.purpose, input.purpose),
        isNull(otpCode.consumedAt),
        gt(otpCode.expiresAt, new Date()),
      ),
    );
  if (count >= MAX_ACTIVE_PER_DEST) {
    return {
      ok: false,
      error: "Too many codes requested. Please wait a few minutes and try again.",
    };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);

  const [row] = await db
    .insert(otpCode)
    .values({
      churchId: input.churchId,
      purpose: input.purpose,
      channel: input.channel,
      destination: input.destination,
      codeHash: hashCode(code),
      memberId: input.memberId ?? null,
      payload: input.payload ?? null,
      expiresAt,
    })
    .returning({ id: otpCode.id });

  return { ok: true, id: row.id, code };
}

export type VerifyOtpResult =
  | {
      ok: true;
      memberId: string | null;
      churchId: string | null;
      payload: Record<string, unknown> | null;
    }
  | { ok: false; error: string };

/**
 * Check a code against a stored OTP (by id). On success the code is marked
 * consumed (single-use) and its payload/memberId are returned so the caller
 * can apply the pending action. Wrong guesses increment attempts.
 */
export async function verifyOtp(id: string, code: string): Promise<VerifyOtpResult> {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, error: "Enter the 6-digit code." };

  const [row] = await db.select().from(otpCode).where(eq(otpCode.id, id)).limit(1);
  if (!row) return { ok: false, error: "This code is no longer valid. Please start again." };
  if (row.consumedAt) return { ok: false, error: "This code has already been used." };
  if (row.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This code has expired. Please request a new one." };
  if (row.attempts >= MAX_ATTEMPTS)
    return { ok: false, error: "Too many wrong attempts. Please request a new code." };

  if (!safeEqualHex(row.codeHash, hashCode(clean))) {
    await db
      .update(otpCode)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCode.id, id));
    return { ok: false, error: "That code is incorrect. Please try again." };
  }

  await db.update(otpCode).set({ consumedAt: new Date() }).where(eq(otpCode.id, id));
  return {
    ok: true,
    memberId: row.memberId,
    churchId: row.churchId,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
  };
}

/** Delete expired/old codes. Called opportunistically by a daily cron. */
export async function purgeExpiredOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const res = await db
    .delete(otpCode)
    .where(sql`${otpCode.expiresAt} < ${cutoff}`)
    .returning({ id: otpCode.id });
  return res.length;
}

/**
 * Read an OTP's owner WITHOUT consuming it.
 *
 * `verifyOtp` marks a correct code used the moment it matches, so any check
 * that could reject the attempt on other grounds — "is this code even for your
 * church?" — has to happen first, or a valid code is burned by a request that
 * was never going to succeed.
 */
export async function peekOtp(id: string) {
  const [row] = await db
    .select({
      churchId: otpCode.churchId,
      purpose: otpCode.purpose,
      channel: otpCode.channel,
      destination: otpCode.destination,
      consumedAt: otpCode.consumedAt,
    })
    .from(otpCode)
    .where(eq(otpCode.id, id))
    .limit(1);
  return row ?? null;
}

/** Latest active OTP id for a destination+purpose (used to resend). */
export async function latestActiveOtp(destination: string, purpose: string) {
  const [row] = await db
    .select({ id: otpCode.id, createdAt: otpCode.createdAt })
    .from(otpCode)
    .where(
      and(
        eq(otpCode.destination, destination),
        eq(otpCode.purpose, purpose),
        isNull(otpCode.consumedAt),
        gt(otpCode.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpCode.createdAt))
    .limit(1);
  return row ?? null;
}
