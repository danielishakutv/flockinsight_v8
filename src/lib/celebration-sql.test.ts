import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { customAnniversaryOn } from "@/lib/celebration-sql";

/**
 * The custom-anniversary predicate has to match the WINDOW, not "has any
 * custom anniversary": the latter put every such member into the capped,
 * unordered candidate list and could crowd today's birthdays out of it.
 */
describe("customAnniversaryOn", () => {
  const render = (keys: string[]) =>
    new PgDialect({ casing: "snake_case" }).sqlToQuery(customAnniversaryOn(keys));

  it("matches each anniversary's month and day against the window keys", () => {
    const q = render(["10-12", "10-13"]);
    expect(q.sql).toContain("jsonb_array_elements");
    expect(q.sql).toContain("substr(ann.elem->>'date', 6, 5) in ($1, $2)");
    expect(q.params).toEqual(["10-12", "10-13"]);
  });

  it("no longer lets any member with an anniversary in regardless of date", () => {
    expect(render(["10-12"]).sql).not.toContain("jsonb_array_length");
  });

  it("never throws on a value that is not an array", () => {
    expect(render(["10-12"]).sql).toContain("jsonb_typeof");
  });

  it("matches nobody for an empty window rather than building `in ()`", () => {
    expect(render([]).sql).toBe("false");
  });
});
