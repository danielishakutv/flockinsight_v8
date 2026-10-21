import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { isUniqueViolation } from "@/lib/pg-errors";

/**
 * Drizzle 0.45 puts the driver's error on `.cause`. Three catches read `.code`
 * off the top and so never matched: Finance's duplicate-name message and the
 * onboarding slug retry were both dead code.
 */

/** What node-postgres throws for a duplicate key, minus the parts we never read. */
function pgDuplicate(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
  });
}

describe("isUniqueViolation", () => {
  it("sees the duplicate under drizzle's wrapper", () => {
    const wrapped = new DrizzleQueryError("insert into ...", [], pgDuplicate("finance_account_name_idx"));
    expect((wrapped as { code?: string }).code).toBeUndefined();
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("still reads a bare driver error", () => {
    expect(isUniqueViolation(pgDuplicate("church_slug_unique"))).toBe(true);
  });

  it("matches a named constraint, and only that one", () => {
    const wrapped = new DrizzleQueryError("insert into ...", [], pgDuplicate("church_slug_unique"));
    expect(isUniqueViolation(wrapped, "church_slug_unique")).toBe(true);
    expect(isUniqueViolation(wrapped, "church_handle_unique")).toBe(false);
  });

  it("is not any other database failure", () => {
    const fk = Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
    expect(isUniqueViolation(new DrizzleQueryError("delete ...", [], fk))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("gives up on a cause chain that loops, rather than hanging", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(isUniqueViolation(a)).toBe(false);
  });
});
