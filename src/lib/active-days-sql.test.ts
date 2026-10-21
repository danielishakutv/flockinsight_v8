import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { rollupSql } from "@/lib/active-days-sql";

/*
 * The rollup decides who becomes a Master or an Expert, so every exclusion in
 * it is a rule about what "real use" means. Each one is pinned here: dropping
 * one would certify demo logins, impersonation or reading the guides as use.
 */
describe("rollupSql", () => {
  const from = new Date("2026-10-19T00:00:00Z");
  const query = new PgDialect().sqlToQuery(rollupSql(from));
  const text = query.sql.replace(/\s+/g, " ");

  for (const fragment of [
    "is_demo = false",
    "temp = false",
    "via_impersonation = false",
    "scope = 'church'",
    "not like '/help%'",
    "not like 'training.certification.%'",
    "at time zone 'UTC'",
    "on conflict (user_id, day)",
    "e.kind = 'pageview'",
  ]) {
    it(`contains ${fragment}`, () => {
      expect(text).toContain(fragment);
    });
  }

  it("binds the date as a parameter instead of inlining it", () => {
    expect(query.params).toContain(from);
    expect(text).not.toContain("2026-10-19");
    // Both halves of the union are bounded by it.
    expect(text.match(/created_at >= \$\d/g)?.length).toBe(2);
  });

  it("replaces the counts on a re-run rather than adding to them", () => {
    expect(text).toContain("pageviews = excluded.pageviews");
    expect(text).not.toMatch(/pageviews = user_active_day\.pageviews \+/);
  });
});
