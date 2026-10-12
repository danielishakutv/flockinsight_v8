import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { church, devotional } from "@/db/schema";
import { automationPaused, inGoodStandingSql } from "@/lib/church-standing";
import { computeStanding } from "@/lib/trial";
import { standingFixtures } from "@/lib/church-standing-fixtures";

/**
 * Which churches the crons may still act for.
 *
 * The rule is the paywall's own — `computeStanding` — so these tests mostly
 * pin that the cron helper says what the paywall says, plus the one place they
 * deliberately differ (the demonstration church). The SQL twin is compared
 * with `computeStanding` against a real database in
 * `church-standing.db-check.ts`; here it is only checked for the shape that
 * has bitten this codebase before (an unqualified column).
 */

const now = new Date("2026-10-11T12:00:00.000Z");
const past = new Date(now.getTime() - 3 * 86_400_000);
const STANDING_FIXTURES = standingFixtures(now);

describe("automationPaused", () => {
  it.each(STANDING_FIXTURES)("agrees with the paywall: $name", ({ row }) => {
    expect(automationPaused({ ...row, isDemo: false }, now)).toBe(
      computeStanding(row, now).gated,
    );
  });

  it("pauses exactly the churches the app itself would lock", () => {
    const paused = STANDING_FIXTURES.filter(({ row }) => automationPaused(row, now)).map(
      (f) => f.name,
    );
    expect(paused).toEqual([
      "trial over, never paid",
      "trial over, plan lapsed",
      "no trial, plan lapsed",
      "comp ended",
      "date on a comp that was switched off",
      "dates as strings",
    ]);
  });

  it("never pauses the demonstration church", () => {
    expect(automationPaused({ isDemo: true, trialEndsAt: past }, now)).toBe(false);
  });
});

describe("inGoodStandingSql", () => {
  it("is qualified by table when the query joins church", () => {
    // The raw-SQL qualifier trap (AGENTS.md): an unqualified column inside a
    // query over two tables binds to whichever has it, silently. Every caller
    // joins church, so every column here must render as "church"."…".
    const q = drizzle
      .mock({ casing: "snake_case" })
      .select({ id: devotional.id })
      .from(devotional)
      .innerJoin(church, eq(church.id, devotional.churchId))
      .where(and(eq(devotional.status, "scheduled"), inGoodStandingSql(now)))
      .toSQL();
    for (const col of [
      "is_demo",
      "plan",
      "payment_waived",
      "payment_waived_until",
      "plan_renews_at",
      "trial_ends_at",
    ]) {
      expect(q.sql).toContain(`"church"."${col}"`);
    }
    // And judges the same instant as computeStanding, not the database clock.
    expect(q.params).toContain(now.toISOString());
    expect(q.sql).not.toMatch(/\bnow\(\)/);
  });
});
