import { describe, expect, it } from "vitest";
import {
  AUDIENCE_CARDS,
  MODULE_GROUPS,
  PROOF,
  REPLACES,
  sectionCopy,
  sections,
} from "@/lib/landing-sections";
import { FEATURES } from "@/lib/landing-content";
import { knownCountries } from "@/lib/country-profile";
import { CURRENCIES } from "@/lib/money";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * The module explorer is a filter over FEATURES by icon key, which means a
 * renamed icon does not error — it silently empties a group. A visitor clicks
 * "Money" and gets nothing, which looks like a broken page and is invisible in
 * review because the other four groups still work.
 */
describe("module groups cover every module exactly once", () => {
  it("names only icons that exist in FEATURES", () => {
    const real = new Set(FEATURES.map((f) => f.icon));
    for (const g of MODULE_GROUPS) {
      for (const icon of g.featureIcons) {
        expect(real.has(icon), `${g.id} -> ${icon}`).toBe(true);
      }
    }
  });

  it("leaves no module out of every group", () => {
    // A module nobody can reach through the filter is a module we paid to
    // build and then hid.
    const grouped = new Set(MODULE_GROUPS.flatMap((g) => g.featureIcons));
    const missing = FEATURES.filter((f) => !grouped.has(f.icon)).map((f) => f.title);
    expect(missing).toEqual([]);
  });

  it("does not put one module in two groups", () => {
    const all = MODULE_GROUPS.flatMap((g) => g.featureIcons);
    expect(all.length).toBe(new Set(all).size);
  });

  it("gives every group a stable id usable as a CSS-only radio value", () => {
    // The filter is pure CSS — the id becomes an input value and a label's
    // `for`, so a space or a capital breaks the selector rather than the data.
    for (const g of MODULE_GROUPS) {
      expect(g.id, g.label).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("the proof strip states figures we can defend", () => {
  /*
   * These four numbers are on the page in 48px type, which is exactly the kind
   * of claim somebody checks. Each is derived from a real table in the
   * codebase, so the assertion is that the marketing figure has not drifted
   * from the thing it describes.
   */
  const by = (label: string) => PROOF.find((p) => p.label.includes(label));

  it("counts modules the way FEATURES does", () => {
    expect(by("modules")?.value).toBe(String(FEATURES.length));
  });

  it("counts countries the way country-profile does", () => {
    expect(by("countries")?.value).toBe(String(knownCountries().length));
  });

  it("counts currencies the way money does", () => {
    expect(by("currencies")?.value).toBe(String(CURRENCIES.length));
  });

  it("counts languages the way locales does", () => {
    expect(by("languages")?.value).toBe(String(LOCALES.length));
  });
});

describe("tables are built to be extracted", () => {
  it("keeps every cell short enough to be a cell", () => {
    /*
     * A table is the content format an AI assistant is most likely to quote,
     * and the reason is that each cell is one comparable fact. A paragraph in a
     * cell destroys that and also wraps badly on a phone, which is where most
     * of this page is read.
     */
    for (const r of REPLACES) {
      expect(r.job.length, r.job).toBeLessThanOrEqual(40);
      expect(r.insteadOf.length, r.insteadOf).toBeLessThanOrEqual(60);
      expect(r.module.length, r.module).toBeLessThanOrEqual(30);
    }
  });

  it("names a specific tool rather than 'various tools'", () => {
    // Vagueness persuades nobody and cannot be quoted.
    const vague = REPLACES.filter((r) =>
      /various|other tools|several tools|etc\.?$/i.test(r.insteadOf),
    );
    expect(vague).toEqual([]);
  });
});

describe("translations are complete", () => {
  /*
   * The failure this prevents is specific and has happened on this page before:
   * a French heading above an English list. Adding a field to SectionCopy
   * without translating it compiles fine and ships a mixed-language section.
   */
  it("fills every field in every reviewed language", () => {
    const keys = Object.keys(sectionCopy.en) as (keyof typeof sectionCopy.en)[];
    for (const lang of ["en", "fr", "pt"] as const) {
      for (const k of keys) {
        const v = sectionCopy[lang][k];
        if (typeof v === "string") {
          expect(v.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
        } else {
          for (const [sub, text] of Object.entries(v)) {
            expect(String(text).trim().length, `${lang}.${k}.${sub}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("does not leave a translation identical to the English", () => {
    /*
     * Catches the copy-paste that looks like a translation. Only the headings
     * are checked — a few short labels legitimately coincide across languages,
     * so the long prose fields are where an untranslated string hides.
     */
    for (const lang of ["fr", "pt"] as const) {
      for (const k of ["moduleIntro", "replacesIntro", "compareIntro"] as const) {
        expect(sectionCopy[lang][k], `${lang}.${k}`).not.toBe(sectionCopy.en[k]);
      }
    }
  });

  it("falls back to English for a language we have not reviewed", () => {
    // ha, ig, yo, sw and pcm have no reviewed landing copy yet. English is the
    // right answer; a half-translated page is not.
    expect(sections("ha")).toBe(sectionCopy.en);
    expect(sections("sw")).toBe(sectionCopy.en);
    expect(sections("fr")).toBe(sectionCopy.fr);
  });
});

describe("audience cards", () => {
  it("says what each audience actually needs, not just names them", () => {
    for (const a of AUDIENCE_CARDS) {
      expect(a.body.length, a.title).toBeGreaterThan(50);
    }
  });
});
