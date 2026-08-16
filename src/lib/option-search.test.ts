import { describe, expect, it } from "vitest";
import {
  matchesSearch,
  normalizeSearchText,
  searchTokens,
  splitOnMatches,
} from "./option-search";

describe("normalizeSearchText", () => {
  it("strips accents, case and extra whitespace", () => {
    expect(normalizeSearchText("  Adéwalé   ÒGÚN ")).toBe("adewale ogun");
  });
});

describe("matchesSearch", () => {
  const tokens = searchTokens;

  it("matches a plain substring", () => {
    expect(matchesSearch("Nigeria", tokens("nig"))).toBe(true);
    expect(matchesSearch("Nigeria", tokens("ghana"))).toBe(false);
  });

  it("ignores accents in the option and in the query", () => {
    expect(matchesSearch("Adéwalé Ogún", tokens("adewale"))).toBe(true);
    expect(matchesSearch("Adewale Ogun", tokens("adéwalé"))).toBe(true);
  });

  it("matches typed words in any order", () => {
    expect(matchesSearch("Doe, John", tokens("john doe"))).toBe(true);
    expect(matchesSearch("Doe, John", tokens("john mary"))).toBe(false);
  });

  it("matches phone numbers regardless of formatting", () => {
    expect(matchesSearch("+234 808 825 6055", tokens("8088256055"))).toBe(true);
    expect(matchesSearch("+234 808 825 6055", tokens("8825"))).toBe(true);
    expect(matchesSearch("+234 808 825 6055", tokens("9999"))).toBe(false);
  });

  it("keeps every option when nothing is typed", () => {
    expect(matchesSearch("anything", tokens("   "))).toBe(true);
  });

  it("never matches an option with no text", () => {
    expect(matchesSearch("", tokens("a"))).toBe(false);
  });
});

describe("splitOnMatches", () => {
  it("returns the whole string when nothing is typed", () => {
    expect(splitOnMatches("Nigeria", [])).toEqual([
      { text: "Nigeria", match: false },
    ]);
  });

  it("marks the typed part of the label", () => {
    expect(splitOnMatches("Nigeria", searchTokens("ger"))).toEqual([
      { text: "Ni", match: false },
      { text: "ger", match: true },
      { text: "ia", match: false },
    ]);
  });

  it("maps back to the original characters when accents were folded", () => {
    expect(splitOnMatches("Adéwalé", searchTokens("dew"))).toEqual([
      { text: "A", match: false },
      { text: "déw", match: true },
      { text: "alé", match: false },
    ]);
  });

  it("merges overlapping words", () => {
    expect(splitOnMatches("Lagos Island", searchTokens("lagos os"))).toEqual([
      { text: "Lagos", match: true },
      { text: " Island", match: false },
    ]);
  });

  it("highlights every occurrence", () => {
    expect(splitOnMatches("aba aba", searchTokens("aba"))).toEqual([
      { text: "aba", match: true },
      { text: " ", match: false },
      { text: "aba", match: true },
    ]);
  });
});
