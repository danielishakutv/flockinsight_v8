/**
 * The weekly blog-draft claim, proven against a real Postgres. Run with
 * `pnpm test:db` against a SCRATCH database only.
 *
 * blog-draft-shared.test.ts covers the pure rules. This file exists for the
 * one thing only a database can answer: what happens when two ticks claim the
 * same ISO week at once (two workers, or a tick and a manual curl).
 *
 * AGENTS.md: a transaction is not isolation, and Promise.all that happens to
 * serialise passes whether the bug is there or not. So the claims are
 * interleaved deliberately on ONE week: the first holds its transaction open,
 * with the row lock its INSERT ... ON CONFLICT took, while the second runs,
 * and only then commits. Exactly one may come back with a row.
 *
 * Every row it makes uses a week in the year 9999, which no real run can
 * have, and those rows are removed afterwards.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blogDraftRun } from "@/db/schema";
import { claimScheduledWeek } from "@/lib/blog-drafts";

const WEEK = `9999-W${String((Date.now() % 50) + 1).padStart(2, "0")}`;

async function cleanup() {
  await db.delete(blogDraftRun).where(eq(blogDraftRun.week, WEEK));
}

describe("claimScheduledWeek", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("lets exactly one of two interleaved claims on one week win", async () => {
    // A failed row with attempts left, so both claims contest the same UPDATE.
    await db
      .insert(blogDraftRun)
      .values({ week: WEEK, trigger: "schedule", status: "failed", attempts: 1 });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let claimed!: () => void;
    const firstClaimed = new Promise<void>((r) => (claimed = r));

    const first = db.transaction(async (tx) => {
      const id = await claimScheduledWeek(WEEK, tx);
      claimed();
      await held;
      return id;
    });
    await firstClaimed;
    // Blocks on the first transaction's row lock until it commits.
    const second = claimScheduledWeek(WEEK);
    await new Promise((r) => setTimeout(r, 300));
    release();

    const [a, b] = await Promise.all([first, second]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("never reclaims a week whose three attempts all failed", async () => {
    await db
      .insert(blogDraftRun)
      .values({ week: WEEK, trigger: "schedule", status: "failed", attempts: 3 });
    expect(await claimScheduledWeek(WEEK)).toBeNull();
  });

  it("reclaims a running row older than 30 minutes, once", async () => {
    await db.insert(blogDraftRun).values({
      week: WEEK,
      trigger: "schedule",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60_000),
    });
    expect(await claimScheduledWeek(WEEK)).not.toBeNull();
    expect(await claimScheduledWeek(WEEK)).toBeNull();
  });

  it("claims a fresh week, then refuses the same week again", async () => {
    expect(await claimScheduledWeek(WEEK)).not.toBeNull();
    expect(await claimScheduledWeek(WEEK)).toBeNull();
  });
});
