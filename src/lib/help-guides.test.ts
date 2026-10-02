import { describe, expect, it } from "vitest";
import {
  GUIDE_CATEGORIES,
  GUIDES,
  getGuide,
  relatedGuides,
  sectionBlocks,
} from "@/lib/help-guides";
import { HELP_ICONS } from "@/components/help/icons";

/**
 * The help guides are pure data, which means every mistake in them is silent.
 *
 * A guide with an icon key that isn't in the map renders the fallback icon and
 * nobody notices. A `related` slug with a typo renders nothing at the foot of
 * the page — the link simply isn't there. A category key that doesn't exist puts
 * the guide in no section of the index, so it can only be found by search. None
 * of those throw, none of them look wrong in review, and all of them are one
 * character.
 *
 * So this asserts the references resolve. It is not a style check on the prose.
 */

describe("the guide catalogue", () => {
  it("has guides", () => {
    // Guards against the suite passing because an import silently came back
    // empty, which would make every other assertion here vacuous.
    expect(GUIDES.length).toBeGreaterThan(5);
  });

  it("has no duplicate slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses slugs that are safe as URL segments", () => {
    for (const g of GUIDES) expect(g.slug, g.title).toMatch(/^[a-z0-9-]+$/);
  });

  it("puts every guide in a category that exists", () => {
    const keys = new Set(GUIDE_CATEGORIES.map((c) => c.key));
    for (const g of GUIDES) {
      expect(keys.has(g.category), `${g.slug} → category "${g.category}"`).toBe(
        true,
      );
    }
  });

  it("uses an icon key that is actually mapped", () => {
    for (const g of GUIDES) {
      expect(HELP_ICONS[g.icon], `${g.slug} → icon "${g.icon}"`).toBeDefined();
    }
  });

  it("only points `related` at guides that exist", () => {
    for (const g of GUIDES) {
      for (const slug of g.related ?? []) {
        expect(getGuide(slug), `${g.slug} → related "${slug}"`).toBeDefined();
      }
      // And the resolver drops nothing it was given.
      expect(relatedGuides(g).length).toBe((g.related ?? []).length);
    }
  });

  it("links to in-app paths, not bare words or external URLs", () => {
    for (const g of GUIDES) {
      for (const l of g.links) {
        expect(l.href, `${g.slug} → "${l.label}"`).toMatch(/^\//);
        expect(l.label.trim().length, `${g.slug} link label`).toBeGreaterThan(0);
      }
    }
  });

  it("has a title and a summary on every guide", () => {
    for (const g of GUIDES) {
      expect(g.title.trim().length, g.slug).toBeGreaterThan(0);
      expect(g.summary.trim().length, g.slug).toBeGreaterThan(0);
    }
  });

  it("has no empty section — a heading with nothing under it", () => {
    for (const g of GUIDES) {
      for (const [i, s] of g.sections.entries()) {
        expect(
          sectionBlocks(s).length,
          `${g.slug} section ${i} ("${s.title ?? "untitled"}")`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives every table the same number of cells as it has headers", () => {
    for (const g of GUIDES) {
      for (const s of g.sections) {
        for (const b of sectionBlocks(s)) {
          if (b.kind !== "table") continue;
          for (const row of b.rows) {
            expect(row.length, `${g.slug} table row`).toBe(b.headers.length);
          }
        }
      }
    }
  });

  it("answers every FAQ it asks", () => {
    for (const g of GUIDES) {
      for (const f of g.faq ?? []) {
        expect(f.q.trim().length, g.slug).toBeGreaterThan(0);
        expect(f.a.trim().length, `${g.slug} → "${f.q}"`).toBeGreaterThan(0);
      }
    }
  });

  it("computes reading time from the content rather than claiming one", () => {
    for (const g of GUIDES) expect(g.minutes).toBeGreaterThanOrEqual(1);
    // A long guide must not read as a one-minute skim.
    const longest = [...GUIDES].sort((a, b) => b.minutes - a.minutes)[0];
    expect(longest.minutes).toBeGreaterThan(1);
  });
});

describe("the contributions guide", () => {
  // The module ships with a public link people are asked to share, so the guide
  // has to cover the two things support will actually be asked about.
  const guide = getGuide("contributions");

  it("exists and is findable in the money section", () => {
    expect(guide).toBeDefined();
    expect(guide!.category).toBe("giving");
  });

  it("can be searched for in the words a church would use", () => {
    const keywords = guide!.keywords ?? [];
    for (const word of ["levy", "collection", "harambee", "whatsapp"]) {
      expect(keywords, word).toContain(word);
    }
  });

  it("explains that a self-reported payment does not move the total", () => {
    const text = JSON.stringify(guide).toLowerCase();
    expect(text).toContain("awaiting confirmation");
  });

  it("explains that the money is not in the church's books until handed over", () => {
    const text = JSON.stringify(guide).toLowerCase();
    expect(text).toContain("handed to the church");
  });
});
