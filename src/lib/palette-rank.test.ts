import { describe, expect, it } from "vitest";
import { escapeRegExp, rankRows, scoreRow, type RankableRow } from "@/lib/palette-rank";

/**
 * A palette whose first row is usually wrong is one people try three times and
 * abandon. Filtering is easy; the ORDER is the feature.
 */

const row = (
  label: string,
  kind: RankableRow["kind"] = "go",
  haystack = "",
): RankableRow => ({ label, kind, haystack: `${label} ${haystack}`.toLowerCase() });

describe("how strongly a row matches", () => {
  it("ranks an exact label highest", () => {
    expect(scoreRow(row("Members"), "members")).toBeGreaterThan(
      scoreRow(row("Members & people"), "members"),
    );
  });

  it("puts the start of a word above the middle of one", () => {
    const prefix = scoreRow(row("Giving"), "giv");
    const wordStart = scoreRow(row("Online giving"), "giv");
    const middle = scoreRow(row("Misgiving"), "giv");
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(middle);
  });

  it("prefers the label over the description", () => {
    const inLabel = scoreRow(row("Giving"), "giving");
    const inDescription = scoreRow(row("Finance", "go", "income and giving"), "giving");
    expect(inLabel).toBeGreaterThan(inDescription);
  });

  it("scores nothing when nothing matches", () => {
    expect(scoreRow(row("Members"), "zzz")).toBe(0);
  });

  it("is case-insensitive on the label", () => {
    expect(scoreRow(row("MEMBERS"), "members")).toBe(
      scoreRow(row("members"), "members"),
    );
  });
});

describe("the order people actually see", () => {
  const ROWS: RankableRow[] = [
    row("Members"),
    row("Member signup link", "settings"),
    row("Add a member", "do", "register new person"),
    row("Groups", "go", "ministries and groups"),
    row("Giving"),
    row("Giving categories", "settings"),
    row("Finance", "go", "income expenses and giving"),
    row("Celebrations", "go", "birthdays"),
  ];

  const labels = (q: string) => rankRows(ROWS, q, 10).map((r) => r.label);

  it("puts the module first for a module's name", () => {
    expect(labels("members")[0]).toBe("Members");
    expect(labels("giving")[0]).toBe("Giving");
  });

  it("keeps a settings page behind the module it configures", () => {
    const out = labels("giving");
    expect(out.indexOf("Giving")).toBeLessThan(out.indexOf("Giving categories"));
  });

  it("offers the action ahead of the page when both match equally", () => {
    // "add a member" is the thing somebody reaching for a command box wants.
    const out = labels("add a member");
    expect(out[0]).toBe("Add a member");
  });

  it("finds a row by a word in its description", () => {
    expect(labels("birthdays")).toContain("Celebrations");
  });

  it("finds a row by a synonym nobody would guess from the label", () => {
    expect(labels("register new person")).toContain("Add a member");
  });

  it("returns nothing for an empty query — the caller shows its own default", () => {
    expect(rankRows(ROWS, "", 10)).toEqual([]);
    expect(rankRows(ROWS, "   ", 10)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(rankRows(ROWS, "i", 3)).toHaveLength(3);
  });

  it("breaks ties the same way every time", () => {
    // Otherwise the list reorders itself between renders for no reason, which
    // reads as the palette being broken.
    const once = labels("giving");
    const twice = labels("giving");
    expect(once).toEqual(twice);
  });
});

describe("a query that is not a word", () => {
  it("does not crash on regex punctuation", () => {
    /*
     * The bug a naive `new RegExp(q)` would have. Somebody typing "giving (" or
     * a lone "[" into the box would throw inside a render and take the whole
     * palette down with it.
     */
    for (const q of ["(", ")", "[", "\\", "*", "+", "?", "^", "$", ".", "|", "{}", "a(b"]) {
      expect(() => rankRows([row("Giving")], q, 5), q).not.toThrow();
    }
  });

  it("treats punctuation as literal text", () => {
    expect(rankRows([row("Giving (offerings)")], "(offerings", 5)).toHaveLength(1);
    expect(rankRows([row("Giving")], "(", 5)).toHaveLength(0);
  });

  it("escapes every character a regex would treat specially", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(new RegExp(escapeRegExp("a.b")).test("a.b")).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});
