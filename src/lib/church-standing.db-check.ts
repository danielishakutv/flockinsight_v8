/**
 * The cron's SQL twin of the paywall, judged by a real Postgres. Run with
 * `pnpm test:db`.
 *
 * `inGoodStandingSql` decides which churches' devotionals the cron may fetch;
 * `computeStanding` decides which churches see the paywall. They are two
 * spellings of one rule, and the day they disagree a church that pays has its
 * devotionals held, or a church that does not has them sent. This evaluates
 * the SQL on every fixture in church-standing-fixtures.ts and compares it with
 * computeStanding on the same row and the same instant.
 *
 * No table is touched: each fixture's values are bound as typed parameters in
 * place of the church columns, so there is nothing to create or clean up.
 */
import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inGoodStandingSql, type StandingRow } from "@/lib/church-standing";
import { standingFixtures } from "@/lib/church-standing-fixtures";
import { computeStanding } from "@/lib/trial";

const now = new Date("2026-10-11T12:00:00.000Z");

function ts(v: Date | string | null | undefined): SQL {
  if (v == null) return sql`null::timestamptz`;
  return sql`${typeof v === "string" ? v : v.toISOString()}::timestamptz`;
}

async function sqlSaysGood(row: StandingRow): Promise<boolean> {
  const fragment = inGoodStandingSql(now, {
    isDemo: sql`${row.isDemo ?? false}::boolean`,
    plan: row.plan == null ? sql`'starter'::text` : sql`${row.plan}::text`,
    paymentWaived: sql`${row.paymentWaived ?? false}::boolean`,
    paymentWaivedUntil: ts(row.paymentWaivedUntil),
    planRenewsAt: ts(row.planRenewsAt),
    trialEndsAt: ts(row.trialEndsAt),
  });
  const res = await db.execute<{ good: boolean }>(sql`select ${fragment} as good`);
  return res.rows[0].good;
}

describe("inGoodStandingSql agrees with computeStanding", () => {
  it.each(standingFixtures(now))("$name", async ({ row }) => {
    // church.plan is NOT NULL with a default of starter; the fixture's
    // absence means that default, for both sides.
    const withPlan = { ...row, plan: row.plan ?? "starter" };
    expect(await sqlSaysGood(withPlan)).toBe(!computeStanding(withPlan, now).gated);
  });

  it("keeps the demonstration church running whatever its dates say", async () => {
    expect(
      await sqlSaysGood({ isDemo: true, trialEndsAt: new Date(now.getTime() - 86_400_000) }),
    ).toBe(true);
  });
});
