/**
 * The data report's figures, run against the real database.
 *
 * Read-only on purpose. These queries are the whole risk in the summary
 * report: group-bys, left joins and three monthly series merged in JS, none of
 * which a unit test with a stubbed `db` would exercise. What it checks is that
 * they RUN and that they agree with each other and with the headline tiles —
 * not exact figures, which belong to whatever happens to be in the dev
 * database today.
 *
 * It inserts nothing and deletes nothing, so it is safe to point at any
 * database you can read. Run with `pnpm test:db`.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getChurchTotals } from "@/lib/report-data";
import { getSummaryInsights, monthLabel } from "@/lib/report-summary";

let churchIds: string[] = [];

beforeAll(async () => {
  churchIds = (await db.select({ id: church.id }).from(church).limit(5)).map(
    (c) => c.id,
  );
});

describe("the figures behind the data report", () => {
  it("has a church to read", () => {
    expect(churchIds.length).toBeGreaterThan(0);
  });

  it("runs for every church, all time and for a window", async () => {
    for (const id of churchIds) {
      for (const range of [
        { from: null, to: null },
        { from: "2026-01-01", to: "2026-12-31" },
        // A window that cannot contain anything. Every section should come
        // back empty rather than throwing or quietly falling back to all time.
        { from: "1990-01-01", to: "1990-01-02" },
      ]) {
        const insights = await getSummaryInsights(id, range);

        expect(Array.isArray(insights.givingByCategory)).toBe(true);
        expect(Array.isArray(insights.months)).toBe(true);

        for (const row of insights.givingByCategory) {
          expect(row.name).toBeTruthy();
          expect(row.total).toBeGreaterThanOrEqual(0);
          expect(row.share).toBeGreaterThanOrEqual(0);
          expect(row.share).toBeLessThanOrEqual(100.001);
        }

        for (const row of insights.attendanceByService) {
          // `best` is a maximum of the same column `average` averages, so it
          // can never be the smaller of the two. If it is, the group-by has
          // bound to the wrong rows.
          expect(row.best).toBeGreaterThanOrEqual(row.average);
          expect(row.sessions).toBeGreaterThan(0);
        }

        const sorted = [...insights.months].sort();
        expect(insights.months.map((m) => m.month)).toEqual(
          sorted.map((m) => m.month),
        );
        for (const m of insights.months) {
          expect(m.month).toMatch(/^\d{4}-\d{2}$/);
          expect(monthLabel(m.month)).not.toBe(m.month);
        }

        for (const c of insights.channels) {
          // Every recipient is reached, failed or skipped — the three are
          // defined to reconcile, and a send that reached more people than it
          // had recipients means the sum is being taken across the wrong rows.
          expect(c.reached + c.failed + c.skipped).toBeLessThanOrEqual(
            c.recipients,
          );
        }

        const anyRows =
          insights.givingByCategory.length +
          insights.attendanceByService.length +
          insights.months.length +
          insights.channels.length;
        if (range.from === "1990-01-01") {
          expect(anyRows).toBe(0);
        }
      }
    }
  });

  it("agrees with the headline tiles it sits under", async () => {
    const range = { from: null, to: null };

    for (const id of churchIds) {
      const [totals, insights] = await Promise.all([
        getChurchTotals(id, range),
        getSummaryInsights(id, range),
      ]);

      /*
       * The giving table prints a "All giving" row taken from `totals`, under
       * rows taken from `insights`. If the two disagree the page contradicts
       * itself in public, which is worse than either being wrong alone.
       *
       * Only the top ten categories are listed, so the comparison is "the
       * parts cannot exceed the whole" rather than equality.
       */
      const listed = insights.givingByCategory.reduce((a, r) => a + r.total, 0);
      expect(listed).toBeLessThanOrEqual(totals.givingTotal + 0.01);

      const sessions = insights.attendanceByService.reduce(
        (a, r) => a + r.sessions,
        0,
      );
      expect(sessions).toBeLessThanOrEqual(totals.sessions);

      // The roll is not filtered by date, so the statuses must account for
      // every member — all four are listed, there is no "top ten" here.
      const onRoll = insights.statuses.reduce((a, r) => a + r.members, 0);
      expect(onRoll).toBe(totals.members);
    }
  });
});
