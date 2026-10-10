import { describe, expect, it } from "vitest";
import {
  COMPARE_CONTENT,
  SOLUTION_TERMS,
  allSeoPaths,
  compareContent,
  comparePath,
  countryPath,
  findComparison,
  findCountry,
  findSolution,
  geoContent,
  slugify,
  solutionContent,
  solutionPath,
} from "@/lib/seo/pages";
import { COMPARISON_TERMS, GEO_TERMS } from "@/lib/seo/keywords";

/**
 * Twenty-two generated pages is exactly the scale at which a template mistake
 * stops being visible in review. These tests cover the three failures that
 * would otherwise ship quietly: a page with no content behind it, two pages at
 * one URL, and a marketing URL that shadows somebody's share link.
 */

describe("every term has a page, and every page has content", () => {
  it("gives every geographic term real content", () => {
    /*
     * A term with no content entry renders a heading and nothing else — a thin
     * page, which is worse than no page: it dilutes the site rather than
     * adding to it.
     */
    for (const t of GEO_TERMS) {
      expect(geoContent(t), t.country).toBeDefined();
    }
  });

  it("gives every solution term real content", () => {
    for (const t of SOLUTION_TERMS) {
      expect(solutionContent(t), t.primary).toBeDefined();
    }
  });

  it("gives every comparison term real content", () => {
    for (const t of COMPARISON_TERMS) {
      expect(compareContent(t), t.competitor).toBeDefined();
    }
  });
});

describe("the content is substantial enough to deserve a URL", () => {
  const all = [
    ...GEO_TERMS.map((t) => [t.country, geoContent(t)] as const),
    ...SOLUTION_TERMS.map((t) => [t.primary, solutionContent(t)] as const),
    ...COMPARISON_TERMS.map((t) => [t.competitor, compareContent(t)] as const),
  ];

  it("writes an H1 addressed to a person, not a keyword", () => {
    /*
     * "Church Management Software Nigeria" as a headline is the sound of a page
     * written for a crawler, and a pastor bounces off it. The keyword belongs
     * in the <title> and in the body. A reliable tell for the bad version is
     * title-case with no verb and no second clause, so the cheap proxy is: the
     * H1 must not be the primary term with capitals applied.
     */
    for (const [label, c] of all) {
      expect(c!.h1.length, label).toBeGreaterThan(20);
      expect(c!.h1, label).not.toBe(c!.h1.toUpperCase());
    }
  });

  it("opens with a summary that answers the question on its own", () => {
    /*
     * The extractable paragraph. Content near the top of a page is weighted
     * heavily by the systems that assemble AI answers, and a summary only works
     * if it is quotable without the rest of the page — which means full
     * sentences and enough of them.
     */
    for (const [label, c] of all) {
      expect(c!.summary.length, label).toBeGreaterThan(220);
      expect(c!.summary.length, label).toBeLessThan(700);
      expect(c!.summary.trim().endsWith("."), label).toBe(true);
    }
  });

  it("carries at least three specific points", () => {
    for (const [label, c] of all) {
      expect(c!.points.length, label).toBeGreaterThanOrEqual(3);
      for (const p of c!.points) {
        expect(p.body.length, `${label} / ${p.title}`).toBeGreaterThan(60);
      }
    }
  });

  it("keeps the FAQ between three and six questions", () => {
    /*
     * Below three there is nothing worth marking up; past about six a page
     * gains no further citations and starts reading as padding. Both ends are
     * worth holding.
     */
    for (const [label, c] of all) {
      expect(c!.faq.length, label).toBeGreaterThanOrEqual(3);
      expect(c!.faq.length, label).toBeLessThanOrEqual(6);
      for (const f of c!.faq) {
        expect(f.q.trim().endsWith("?"), `${label} / ${f.q}`).toBe(true);
        // Roughly 40-60 words is the band that gets quoted. Allow some slack,
        // but catch the one-line answer and the three-paragraph essay.
        const words = f.a.split(/\s+/).length;
        expect(words, `${label} / ${f.q} (${words} words)`).toBeGreaterThan(20);
        expect(words, `${label} / ${f.q} (${words} words)`).toBeLessThan(90);
      }
    }
  });
});

describe("comparison pages send people away when they should", () => {
  it("names who should buy the competitor instead", () => {
    /*
     * The load-bearing honesty on the most commercially sensitive pages we
     * publish. A comparison page with an empty `chooseThemIf` is a brochure,
     * and both a reader and a model treat it as one.
     */
    for (const [competitor, c] of Object.entries(COMPARE_CONTENT)) {
      expect(c.chooseThemIf.length, competitor).toBeGreaterThanOrEqual(2);
      expect(c.chooseUsIf.length, competitor).toBeGreaterThanOrEqual(2);
      for (const line of c.chooseThemIf) {
        expect(line.length, competitor).toBeGreaterThan(30);
      }
    }
  });
});

describe("URLs", () => {
  it("produces no duplicate path", () => {
    const paths = allSeoPaths();
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it("never shadows a short share route", () => {
    /*
     * The root namespace holds the links churches hand out: /c/<handle>,
     * /p/<slug>, /l/<code>, /s/<slug>, /r/<code>, /f/<slug>, /m/<token>,
     * /n/..., /give/<slug>, /hub/<slug>, /join/<slug>, /meet/<code>,
     * /welcome/<slug>, /live/<slug>. A marketing page that captured one of
     * those prefixes would break every QR code already printed on a flyer.
     */
    const reserved = [
      "c", "p", "l", "s", "r", "f", "m", "n", "give", "hub", "join",
      "meet", "welcome", "live", "api", "blog", "churches", "events",
      "pricing", "demo", "login", "signup", "roadmap", "changelog",
      "privacy", "terms", "try", "onboarding",
    ];
    for (const path of allSeoPaths()) {
      const first = path.split("/")[1];
      expect(reserved, path).not.toContain(first);
    }
  });

  it("round-trips every path back to its term", () => {
    // The dynamic routes resolve a slug to a term. A slug that cannot be found
    // again is a 404 on a page that is in the sitemap.
    for (const t of GEO_TERMS) {
      const slug = countryPath(t).split("/").pop()!;
      expect(findCountry(slug)?.country, t.country).toBe(t.country);
    }
    for (const t of SOLUTION_TERMS) {
      const slug = solutionPath(t).split("/").pop()!;
      expect(findSolution(slug)?.primary, t.primary).toBe(t.primary);
    }
    for (const t of COMPARISON_TERMS) {
      const slug = comparePath(t).split("/").pop()!;
      expect(findComparison(slug)?.competitor, t.competitor).toBe(t.competitor);
    }
  });

  it("returns undefined for an unknown slug rather than guessing", () => {
    expect(findCountry("narnia")).toBeUndefined();
    expect(findSolution("something-we-do-not-do")).toBeUndefined();
    expect(findComparison("nobody")).toBeUndefined();
  });
});

describe("slugify", () => {
  it("strips accents rather than encoding them", () => {
    // "Côte d'Ivoire" must not become a percent-encoded URL.
    expect(slugify("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(slugify("São Tomé and Príncipe")).toBe("sao-tome-and-principe");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(slugify("  Breeze ChMS!  ")).toBe("breeze-chms");
    expect(slugify("church software — slow internet")).toBe(
      "church-software-slow-internet",
    );
  });
});
