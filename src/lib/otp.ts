import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
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
// Comparisons before a code is dead. Every comparison counts, the right one
// included, so a code can be tested at most this many times in total.
export const MAX_ATTEMPTS = 5;
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
 * can apply the pending action.
 *
 * Every comparison claims an attempt FIRST, atomically, and only then
 * compares. This used to read `attempts`, compare, and write back
 * `row.attempts + 1` from the value it had read — so a burst of parallel
 * guesses all read 0, all compared, and left the counter at 1. A script
 * keeping fifty requests in flight could test thousands of codes against one
 * id inside its ten minutes instead of five. Now the UPDATE is the gate:
 *
 *   update otp_code set attempts = attempts + 1
 *   where id = $1 and attempts < 5 and consumed_at is null and expires_at > now()
 *   returning attempts
 *
 * Postgres serialises concurrent UPDATEs of one row and re-checks the WHERE
 * against the committed value, so exactly five claims can ever succeed.
 * Consuming is the same shape (`where consumed_at is null returning`), so two
 * simultaneous correct submissions cannot both apply the payload.
 *
 * `expectedPurpose`, when given, refuses a code issued for something else
 * before any attempt is spent.
 */
export async function verifyOtp(
  id: string,
  code: string,
  opts?: { expectedPurpose?: string },
): Promise<VerifyOtpResult> {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, error: "Enter the 6-digit code." };

  const [row] = await db.select().from(otpCode).where(eq(otpCode.id, id)).limit(1);
  if (!row) return { ok: false, error: "This code is no longer valid. Please start again." };
  if (opts?.expectedPurpose && row.purpose !== opts.expectedPurpose)
    return { ok: false, error: "This code is no longer valid. Please start again." };
  if (row.consumedAt) return { ok: false, error: "This code has already been used." };
  if (row.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This code has expired. Please request a new one." };

  const [claimed] = await db
    .update(otpCode)
    .set({ attempts: sql`${otpCode.attempts} + 1` })
    .where(
      and(
        eq(otpCode.id, id),
        lt(otpCode.attempts, MAX_ATTEMPTS),
        isNull(otpCode.consumedAt),
        gt(otpCode.expiresAt, new Date()),
      ),
    )
    .returning({ attempts: otpCode.attempts });
  if (!claimed) {
    return { ok: false, error: "Too many wrong attempts. Please request a new code." };
  }

  if (!safeEqualHex(row.codeHash, hashCode(clean))) {
    return { ok: false, error: "That code is incorrect. Please try again." };
  }

  const [used] = await db
    .update(otpCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCode.id, id), isNull(otpCode.consumedAt)))
    .returning({ id: otpCode.id });
  if (!used) return { ok: false, error: "This code has already been used." };

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
      /*
       * The payload too, so a caller can answer "is this code yours?" before
       * spending it. A personal change is not scoped by church — a code that
       * moves somebody's own login email belongs to a user id, and that id
       * only exists in here.
       */
      payload: otpCode.payload,
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
