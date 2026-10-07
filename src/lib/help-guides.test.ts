import { describe, expect, it } from "vitest";
import {
  GUIDE_CATEGORIES,
  GUIDES,
  getGuide,
  relatedGuides,
  sectionBlocks,
} from "@/lib/help-guides";
import { HELP_ICONS } from "@/components/help/icons";
import { SHORTCUTS, keysLabel } from "@/lib/shortcuts";
import { MNEMONICS } from "@/lib/shortcut-mnemonics";
import { en } from "@/lib/i18n/dictionaries/en";

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

/* ------------------------------------------------------------------ *
 * The keyboard shortcuts guide
 * ------------------------------------------------------------------ */

describe("the keyboard shortcuts guide", () => {
  const guide = getGuide("keyboard-shortcuts");

  /** Every "Press" cell in the guide's tables. */
  const printedKeys = (() => {
    const out: string[] = [];
    for (const s of guide?.sections ?? []) {
      for (const b of sectionBlocks(s)) {
        if (b.kind !== "table") continue;
        if (b.headers[0] !== "Press") continue;
        for (const r of b.rows) out.push(r[0]);
      }
    }
    return out;
  })();

  it("exists at the slug the app links to", () => {
    /*
     * The `?` sheet, the tip card and the settings panel all link to
     * /help/keyboard-shortcuts. A renamed slug makes all three dead links,
     * and nothing else would notice.
     */
    expect(guide, "the sheet, the tip and Settings all link here").toBeDefined();
    expect(guide!.slug).toBe("keyboard-shortcuts");
  });

  it("documents every shortcut in the registry", () => {
    // A shortcut nobody wrote down is one nobody will find.
    for (const s of SHORTCUTS) {
      expect(
        printedKeys.includes(keysLabel(s.keys, false)),
        `${s.id} ("${keysLabel(s.keys, false)}") is not in any table in the guide`,
      ).toBe(true);
    }
  });

  it("prints exactly the keys the app would print", () => {
    /*
     * The tables are generated from the registry, so this is really a test
     * that they still are. The failure it guards against is somebody "fixing"
     * a table by hand: the guide would then tell four hundred churches to
     * press a key the app does not listen for, and the in-app sheet — which
     * generates itself — would quietly disagree with it.
     */
    const fromRegistry = SHORTCUTS.map((s) => keysLabel(s.keys, false)).sort();
    expect([...printedKeys].sort()).toEqual(fromRegistry);
  });

  it("writes Ctrl rather than ⌘, since a written page cannot know the machine", () => {
    const text = JSON.stringify(guide);
    expect(printedKeys).toContain("Ctrl K");
    // The prose may mention ⌘ in passing; the TABLES must not.
    expect(printedKeys.some((k) => k.includes("⌘"))).toBe(false);
    expect(text).toContain("Mac");
  });

  it("explains the three letters that are not first letters", () => {
    const text = JSON.stringify(guide).toLowerCase();
    for (const word of ["bookings", "visitors", "g-r-oups"]) {
      expect(text, `the guide should say where the letter came from: ${word}`).toContain(
        word,
      );
    }
  });

  it("says the tips can be turned off, and where", () => {
    const text = JSON.stringify(guide).toLowerCase();
    expect(text).toContain("no more tips");
    expect(text).toContain("settings");
  });

  it("can be found by the words somebody would actually search", () => {
    const hay = [
      guide!.title,
      guide!.summary,
      ...(guide!.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();
    for (const term of ["keyboard", "shortcut", "ctrl k", "command palette"]) {
      expect(hay, term).toContain(term);
    }
  });
});

describe("the mnemonics", () => {
  it("name real shortcuts", () => {
    for (const id of Object.keys(MNEMONICS)) {
      expect(
        SHORTCUTS.some((s) => s.id === id),
        `MNEMONICS has "${id}", which is not a shortcut`,
      ).toBe(true);
    }
  });

  it("explain every letter that is not the first letter of its label", () => {
    /*
     * The rule the sheet relies on: if the key cannot be worked out from the
     * words on screen, it must say where it came from. Otherwise it is a thing
     * to memorise, and nobody memorises it.
     */
    for (const s of SHORTCUTS) {
      if (s.group !== "go") continue;
      const letter = s.keys[1];
      if (!letter) continue;
      const label = englishLabel(s.labelKey).toLowerCase();
      if (label.startsWith(letter)) continue;
      expect(
        MNEMONICS[s.id],
        `"${s.keys.join(" ")}" → ${label}: the letter is not obvious, so the sheet must explain it`,
      ).toBeDefined();
    }
  });
});

function englishLabel(key: string): string {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}
