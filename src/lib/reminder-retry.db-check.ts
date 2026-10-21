/**
 * Database-backed checks for the reminder SMS retry claim. Run with
 * `pnpm test:db`.
 *
 * reminder-retry.test.ts covers the RULE with no database. This file exists
 * for the one thing only a real Postgres can answer: when two sweeps reach the
 * same failed text at once, does exactly one of them claim it? A second claim
 * would text a whole congregation twice.
 *
 * The claim is one conditional UPDATE (claimServiceSmsRetry). Under READ
 * COMMITTED the second UPDATE blocks on the row lock, re-evaluates its WHERE
 * against the committed row and must match nothing. Promise.all over two
 * claims would pass whether or not that held, because they may simply run one
 * after the other, so the two are interleaved on purpose over ONE row: the
 * first holds its transaction open while the second is provably waiting.
 *
 * Creates its own church and removes exactly what it created (the run and the
 * service cascade from it).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, reminderRun, service } from "@/db/schema";
import { claimServiceSmsRetry } from "@/lib/service-reminders";

const STAMP = Date.now().toString(36);
const CHURCH_ID = `zzcheck-reminder-retry-${STAMP}`;
let serviceId = "";
let runId = "";

function defer() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Put the one contested row back to "failed, first attempt, two hours ago". */
async function resetRun() {
  await db
    .update(reminderRun)
    .set({
      smsOutcome: "failed",
      smsAttempts: 1,
      smsDetail: "Not enough SMS balance.",
      updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
    })
    .where(eq(reminderRun.id, runId));
}

beforeAll(async () => {
  await db
    .insert(church)
    .values({ id: CHURCH_ID, name: `Reminder Retry Check ${STAMP}`, slug: CHURCH_ID, currency: "NGN" });
  const [svc] = await db
    .insert(service)
    .values({ churchId: CHURCH_ID, name: "Sunday Service", dayOfWeek: 0, startTime: "10:00" })
    .returning({ id: service.id });
  serviceId = svc.id;
  const [run] = await db
    .insert(reminderRun)
    .values({
      churchId: CHURCH_ID,
      serviceId,
      serviceDate: "2026-10-25",
      smsOutcome: "failed",
      smsAttempts: 1,
      updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
    })
    .returning({ id: reminderRun.id });
  runId = run.id;
});

afterAll(async () => {
  await db.delete(church).where(eq(church.id, CHURCH_ID));
});

describe("the retry claim, interleaved over one row", () => {
  it("lets exactly one of two overlapping sweeps claim a failed text", async () => {
    await resetRun();
    const holding = defer();
    const release = defer();
    let first = false;

    // T1 claims and holds its transaction open, so the row stays locked.
    const t1 = db.transaction(async (tx) => {
      first = await claimServiceSmsRetry(tx, {
        runId,
        churchId: CHURCH_ID,
        attempts: 1,
        now: new Date(),
      });
      holding.resolve();
      await release.promise;
    });
    await holding.promise;

    // T2 runs the same claim and must block on T1's row lock.
    const t2 = claimServiceSmsRetry(db, {
      runId,
      churchId: CHURCH_ID,
      attempts: 1,
      now: new Date(),
    });
    // Long enough for T2 to reach the lock; it cannot pass it yet.
    await new Promise((r) => setTimeout(r, 300));
    release.resolve();
    await t1;
    const second = await t2;

    expect(first).toBe(true);
    expect(second).toBe(false);
    const [row] = await db
      .select({ smsOutcome: reminderRun.smsOutcome, smsAttempts: reminderRun.smsAttempts })
      .from(reminderRun)
      .where(eq(reminderRun.id, runId));
    expect(row).toEqual({ smsOutcome: "pending", smsAttempts: 2 });
  });

  it("will not claim a failure younger than the retry spacing", async () => {
    await resetRun();
    await db
      .update(reminderRun)
      .set({ updatedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(reminderRun.id, runId));
    expect(
      await claimServiceSmsRetry(db, { runId, churchId: CHURCH_ID, attempts: 1, now: new Date() }),
    ).toBe(false);
  });

  it("will not claim another church's row", async () => {
    await resetRun();
    expect(
      await claimServiceSmsRetry(db, {
        runId,
        churchId: "zzcheck-not-this-church",
        attempts: 1,
        now: new Date(),
      }),
    ).toBe(false);
  });
});

describe("the database holds the budget too", () => {
  it("rejects a fourth attempt", async () => {
    await expect(
      db.execute(sql`update reminder_run set sms_attempts = 4 where id = ${runId}`),
    ).rejects.toThrow();
  });

  it("rejects an outcome nobody wrote the code for", async () => {
    await expect(
      db.execute(sql`update reminder_run set sms_outcome = 'bogus' where id = ${runId}`),
    ).rejects.toThrow();
  });
});
