import { describe, expect, it } from "vitest";
import {
  ALL_TERMS,
  COMPARISON_TERMS,
  DIFFERENTIATOR_TERMS,
  ENTITY_SENTENCE,
  ENTITY_SENTENCE_SHORT,
  FORBIDDEN_CLAIMS,
  GEO_TERMS,
} from "@/lib/seo/keywords";
import { knownCountries } from "@/lib/country-profile";
import { FAQ, FEATURES, HIGHLIGHTS } from "@/lib/landing-content";

/**
 * The keyword map is strategy, and strategy rots silently.
 *
 * Nothing here checks whether a term is a *good* term — that is a judgement
 * call and belongs in review. These check the mechanical mistakes that would
 * otherwise reach production invisibly: two pages fighting for one phrase, a
 * page promising a country we cannot bill in, a comparison page that forgot to
 * admit the competitor's strengths, and a forbidden claim creeping back into
 * the copy because somebody wanted a punchier headline.
 */

describe("one page, one phrase", () => {
  it("has no duplicate primary term", () => {
    /*
     * Two pages targeting the same phrase split their own authority and let
     * Google pick whichever it likes, which is usually the thinner one. This is
     * the single most expensive mistake in a keyword plan and the easiest to
     * make, because the duplicate is always added months after the original by
     * somebody who did not read the whole file.
     */
    const seen = new Map<string, number>();
    for (const t of ALL_TERMS) {
      seen.set(t.primary, (seen.get(t.primary) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(dupes).toEqual([]);
  });

  it("keeps every primary term lowercase and trimmed", () => {
    // Pages title-case these themselves; a stray capital produces two slugs.
    for (const t of ALL_TERMS) {
      expect(t.primary, t.primary).toBe(t.primary.trim().toLowerCase());
    }
  });

  it("never lists a primary term as its own variant", () => {
    for (const t of ALL_TERMS) {
      expect(t.variants, t.primary).not.toContain(t.primary);
    }
  });

  it("does not reuse one variant across two different terms", () => {
    /*
     * A shared variant is a softer version of the duplicate-primary problem:
     * both pages optimise for it, neither owns it. Allowed to be caught here
     * rather than argued about later.
     */
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const t of ALL_TERMS) {
      for (const v of t.variants) {
        const existing = owner.get(v);
        if (existing && existing !== t.primary) {
          clashes.push(`"${v}" claimed by both "${existing}" and "${t.primary}"`);
        }
        owner.set(v, t.primary);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("every term is backed by something real", () => {
  it("names at least one module behind each claim", () => {
    /*
     * A page that ranks for a job the product does not do is a bounce, and an
     * assistant that catches one overstatement discounts the whole domain.
     */
    for (const t of ALL_TERMS) {
      expect(t.backedBy.length, t.primary).toBeGreaterThan(0);
    }
  });

  it("asks a real question, as a sentence", () => {
    // The AIEO half: assistants retrieve against the question, so the question
    // has to read like something a person would actually type.
    for (const t of ALL_TERMS) {
      expect(t.question.endsWith("?"), t.primary).toBe(true);
      expect(t.question.split(" ").length, t.primary).toBeGreaterThan(4);
    }
  });
});

describe("geographic terms", () => {
  it("only targets countries we can actually bill and schedule", () => {
    /*
     * A country page states its currency and its timezone. If the country is
     * missing from `country-profile.ts`, those come from FALLBACK_PROFILE —
     * USD and UTC — and the page quietly promises a Kenyan church pricing in
     * dollars on the wrong clock.
     */
    const known = new Set(knownCountries());
    for (const t of GEO_TERMS) {
      expect(known.has(t.country), t.country).toBe(true);
    }
  });

  it("names the country in the phrase itself", () => {
    /*
     * Otherwise the page is targeting a term it does not contain. Where the
     * search phrase and the country's name differ — "uk", not "united
     * kingdom" — `searchName` has to record it, so the mismatch is a decision
     * somebody wrote down rather than one this test stopped noticing.
     */
    for (const t of GEO_TERMS) {
      const wanted = (t.searchName ?? t.country).toLowerCase().split(" ")[0];
      expect(t.primary.includes(wanted), `${t.primary} / ${t.country}`).toBe(true);
    }
  });

  it("says something locally true and checkable", () => {
    for (const t of GEO_TERMS) {
      expect(t.localTruth.length, t.country).toBeGreaterThan(40);
    }
  });
});

describe("comparison pages stay honest", () => {
  it("admits what the competitor does better", () => {
    /*
     * This is the load-bearing assertion in the file. A comparison page that
     * only lists our wins is read as marketing by a person and discounted by an
     * assistant; the page that names the trade-off is the one that gets quoted.
     * The sentence is rendered verbatim, so it has to be a real sentence.
     */
    for (const t of COMPARISON_TERMS) {
      expect(t.honestWeakness.length, t.competitor).toBeGreaterThan(60);
      expect(t.honestWeakness.trim().endsWith("."), t.competitor).toBe(true);
    }
  });

  it("names the competitor in the phrase", () => {
    for (const t of COMPARISON_TERMS) {
      const token = t.competitor.toLowerCase().split(" ")[0];
      const mentioned =
        t.primary.includes(token) || t.primary.includes("free church");
      expect(mentioned, t.primary).toBe(true);
    }
  });

  it("states our edge without a superlative", () => {
    for (const t of COMPARISON_TERMS) {
      expect(t.ourEdge.length, t.competitor).toBeGreaterThan(40);
      expect(t.ourEdge.toLowerCase(), t.competitor).not.toMatch(
        /\bbest\b|\b#1\b|\bnumber one\b/,
      );
    }
  });
});

describe("differentiators are ours", () => {
  it("covers the four things the field does not do", () => {
    /*
     * Not a style rule — a reminder. These four are the reason the product is
     * not interchangeable with a member database, and if one disappears from
     * this list it has probably disappeared from the marketing too.
     */
    const joined = DIFFERENTIATOR_TERMS.map((t) =>
      [t.primary, ...t.variants].join(" "),
    ).join(" ");
    for (const must of ["offline", "currency", "sender id", "meeting", "facilities"]) {
      expect(joined, must).toContain(must);
    }
  });
});

describe("the entity sentence", () => {
  it("fits where it is quoted", () => {
    // The short form goes in an OG description and a <title>'s neighbourhood.
    expect(ENTITY_SENTENCE_SHORT.length).toBeLessThanOrEqual(180);
    expect(ENTITY_SENTENCE.length).toBeGreaterThan(180);
  });

  it("says what it is before where it is from", () => {
    /*
     * Positioning, enforced. The product is a church operations platform that
     * happens to be engineered in Nigeria — not a Nigerian product that happens
     * to manage churches. Reverse those and every assistant answering "church
     * software for a church in London" rules us out in its first sentence.
     */
    const what = ENTITY_SENTENCE.toLowerCase().indexOf("church management");
    const where = ENTITY_SENTENCE.toLowerCase().indexOf("nigeria");
    expect(what).toBeGreaterThanOrEqual(0);
    expect(where).toBeGreaterThan(what);
  });

  it("does not limit the product to one continent", () => {
    // "for Africa" in a title is an instruction to exclude us everywhere else.
    expect(ENTITY_SENTENCE.toLowerCase()).not.toMatch(/software for africa|for africa\b/);
  });
});

describe("forbidden claims stay out of the copy", () => {
  /*
   * The marketing copy lives in `landing-content.ts` and gets edited by whoever
   * wants a stronger headline that week. These phrases each cost something
   * specific — an unverifiable traction number, a self-awarded superlative, a
   * feature we do not ship — and the reason is recorded beside each one.
   */
  const copy = [
    ...FEATURES.flatMap((f) => [f.title, f.body]),
    ...FAQ.flatMap((f) => [f.q, f.a]),
    ...HIGHLIGHTS.map((h) => h.label),
  ]
    .join(" ")
    .toLowerCase();

  for (const { phrase, why } of FORBIDDEN_CLAIMS) {
    it(`never says "${phrase}"`, () => {
      expect(copy, why).not.toContain(phrase.toLowerCase());
    });
  }
});
