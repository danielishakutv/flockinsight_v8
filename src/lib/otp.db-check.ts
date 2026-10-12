/**
 * Database-backed checks for one-time codes. Run with `pnpm test:db`.
 *
 * The attempt counter used to be read, compared and written back from the
 * value read — so N guesses in flight at once all saw attempts = 0, all got a
 * comparison, and left the counter at 1. Only real concurrent UPDATEs against
 * a real Postgres can show whether the claim is atomic now, so: many requests
 * fired together at ONE code, and a count afterwards.
 *
 * Every fixture is an otp_code row with a "zzcheck-" destination, removed by
 * id at the end. No church is touched (churchId is null).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { otpCode } from "@/db/schema";
import { MAX_ATTEMPTS, issueOtp, verifyOtp } from "@/lib/otp";

const STAMP = Date.now().toString(36);
const made: string[] = [];

async function freshCode(tag: string) {
  const res = await issueOtp({
    churchId: null,
    purpose: `zzcheck-${tag}`,
    channel: "email",
    destination: `zzcheck-${tag}-${STAMP}@example.invalid`,
  });
  if (!res.ok) throw new Error(res.error);
  made.push(res.id);
  return res;
}

function wrong(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

afterAll(async () => {
  if (made.length > 0) await db.delete(otpCode).where(inArray(otpCode.id, made));
});

describe("verifyOtp under concurrency", () => {
  it("lets no more than MAX_ATTEMPTS comparisons through, however many arrive at once", async () => {
    const { id, code } = await freshCode("burst");
    const bad = wrong(code);

    const results = await Promise.all(
      Array.from({ length: 40 }, () => verifyOtp(id, bad)),
    );
    const compared = results.filter(
      (r) => !r.ok && r.error === "That code is incorrect. Please try again.",
    ).length;
    expect(compared).toBe(MAX_ATTEMPTS);

    const [row] = await db
      .select({ attempts: otpCode.attempts })
      .from(otpCode)
      .where(eq(otpCode.id, id));
    expect(row.attempts).toBe(MAX_ATTEMPTS);

    // The right code is dead now too.
    const late = await verifyOtp(id, code);
    expect(late.ok).toBe(false);
  });

  it("applies a correct code exactly once when it is submitted twice at the same moment", async () => {
    const { id, code } = await freshCode("double");
    const [a, b] = await Promise.all([verifyOtp(id, code), verifyOtp(id, code)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("refuses a code issued for another purpose without spending an attempt", async () => {
    const { id, code } = await freshCode("purpose");
    const res = await verifyOtp(id, code, { expectedPurpose: "something-else" });
    expect(res.ok).toBe(false);
    const [row] = await db
      .select({ attempts: otpCode.attempts, consumedAt: otpCode.consumedAt })
      .from(otpCode)
      .where(eq(otpCode.id, id));
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
  });
});
