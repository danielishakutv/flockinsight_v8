import { describe, expect, it } from "vitest";
import { DICTIONARIES, en } from "@/lib/i18n/dictionaries";
import { LOCALES, matchAcceptLanguage, type LocaleCode } from "@/lib/i18n/locales";
import { makeT } from "@/lib/i18n/translate";

/**
 * The type system already guarantees the SHAPE of every dictionary: each locale
 * is typed as `Dictionary`, so a missing key or a string where a plural pair
 * belongs fails `tsc`. These tests cover what types cannot see.
 *
 *   - A key present but empty. Typed fine, renders as nothing at all.
 *   - A `{name}` placeholder dropped or renamed in translation, so a sentence
 *     renders "Hello {name}" or loses the name entirely.
 *   - A whole file copy-pasted from English and never actually translated.
 *   - Plural forms that do not vary where the language needs them to.
 */

type Leaf = string | { one: string; other: string };

/** Every leaf, as a flat map of dotted path -> value. */
function flatten(
  node: unknown,
  prefix = "",
  out = new Map<string, Leaf>(),
): Map<string, Leaf> {
  if (node === null || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(path, value);
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { other?: unknown }).other === "string"
    ) {
      out.set(path, value as { one: string; other: string });
    } else {
      flatten(value, path, out);
    }
  }
  return out;
}

const ENGLISH = flatten(en);
const CODES = Object.keys(DICTIONARIES) as LocaleCode[];

/** The `{placeholders}` a string uses, as a sorted list. */
function placeholders(value: Leaf): string[] {
  const text =
    typeof value === "string" ? value : `${value.one} ${value.other}`;
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function strings(value: Leaf): string[] {
  return typeof value === "string" ? [value] : [value.one, value.other];
}

describe("the locale list", () => {
  it("has a dictionary for every language offered, and no orphans", () => {
    const offered = LOCALES.map((l) => l.code).sort();
    expect(CODES.slice().sort()).toEqual(offered);
  });

  it("has no duplicate codes", () => {
    expect(new Set(CODES).size).toBe(CODES.length);
  });

  it("marks English, French and Portuguese reviewed and the rest not", () => {
    // The UI promises this distinction; a locale silently flipping to
    // "reviewed" would present unchecked work as finished.
    const reviewed = LOCALES.filter((l) => l.reviewed).map((l) => l.code).sort();
    expect(reviewed).toEqual(["en", "fr", "pt"]);
  });

  it("gives every language a name in its own language", () => {
    for (const l of LOCALES) {
      expect(l.native.trim().length, l.code).toBeGreaterThan(0);
      expect(l.name.trim().length, l.code).toBeGreaterThan(0);
    }
  });
});

describe.each(CODES)("%s", (code) => {
  const dict = flatten(DICTIONARIES[code]);

  it("has exactly the English keys", () => {
    // `tsc` enforces this too. Asserted here so the failure names the key
    // rather than printing a hundred-line structural type error.
    const missing = [...ENGLISH.keys()].filter((k) => !dict.has(k));
    const extra = [...dict.keys()].filter((k) => !ENGLISH.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("has no blank strings", () => {
    const blank = [...dict.entries()]
      .filter(([, v]) => strings(v).some((s) => s.trim() === ""))
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it("keeps every placeholder English uses, and invents none", () => {
    const wrong: string[] = [];
    for (const [key, english] of ENGLISH) {
      const mine = dict.get(key);
      if (!mine) continue;
      const want = placeholders(english);
      const got = placeholders(mine);
      if (want.join(",") !== got.join(",")) {
        wrong.push(`${key}: expected {${want.join("} {")}}, got {${got.join("} {")}}`);
      }
    }
    // A dropped placeholder loses a name or a number from a sentence; a renamed
    // one renders the braces to the reader.
    expect(wrong).toEqual([]);
  });

  it("has a plural pair everywhere English has one", () => {
    const wrong: string[] = [];
    for (const [key, english] of ENGLISH) {
      const mine = dict.get(key);
      if (!mine) continue;
      if (typeof english !== typeof mine) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });

  it("is actually translated, not a copy of English", () => {
    if (code === "en") return;
    /*
     * Some strings are legitimately identical in every language — SMS, CSV,
     * PDF, WhatsApp, FlockInsight, "Menu". Pidgin shares a great deal more with
     * English than the others do, and that is correct rather than lazy. So the
     * bar is deliberately low: it catches a file copied and never touched, and
     * lets genuine overlap through.
     */
    const total = ENGLISH.size;
    let differs = 0;
    for (const [key, english] of ENGLISH) {
      const mine = dict.get(key);
      if (!mine) continue;
      if (strings(english).join("\u0000") !== strings(mine).join("\u0000")) differs++;
    }
    const ratio = differs / total;
    const floor = code === "pcm" ? 0.4 : 0.8;
    expect(ratio, `${code} differs from English in ${Math.round(ratio * 100)}%`)
      .toBeGreaterThan(floor);
  });
});

describe("the t() function", () => {
  it("interpolates", () => {
    const t = makeT("en", en);
    expect(t("meetings.slideOf", { index: 2, total: 9 })).toBe("Slide 2 of 9");
  });

  it("leaves an unmatched placeholder visible rather than deleting it", () => {
    // Visible is a bug a translator reports; silently gone is a bug nobody
    // notices until a sentence has been wrong for months.
    const t = makeT("en", en);
    expect(t("meetings.slideOf", { index: 2 })).toContain("{total}");
  });

  it("picks the plural form by count", () => {
    const t = makeT("en", en);
    expect(t("common.people", { count: 1 })).toBe("1 person");
    expect(t("common.people", { count: 4 })).toBe("4 people");
    expect(t("common.people", { count: 0 })).toBe("0 people");
  });

  it("uses each language's own plural rules", () => {
    // French treats 0 and 1 alike, English does not. If this ever regresses,
    // French reads "0 jours restants" where it should read "0 jour restant".
    const fr = makeT("fr", DICTIONARIES.fr);
    expect(fr("billing.trialDaysLeft", { count: 0 })).toContain("jour restant");
    expect(fr("billing.trialDaysLeft", { count: 3 })).toContain("jours restants");

    const enT = makeT("en", en);
    expect(enT("billing.trialDaysLeft", { count: 0 })).toContain("days left");
  });

  it("answers in the locale it was built for", () => {
    for (const code of CODES) {
      const t = makeT(code, DICTIONARIES[code]);
      expect(t.locale).toBe(code);
      expect(t("common.save").length).toBeGreaterThan(0);
    }
  });

  it("falls back to English when a key is somehow missing", () => {
    // Only reachable across a rolling deploy, where a page outlives its build.
    const stale = { common: { save: "Hifadhi" } } as unknown as typeof en;
    const t = makeT("sw", stale, en);
    expect(t("common.save")).toBe("Hifadhi");
    expect(t("meetings.title")).toBe("Meetings");
  });

  it("returns something readable even with no fallback at all", () => {
    const t = makeT("en", {} as unknown as typeof en);
    expect(t("common.saveChanges")).toBe("Save changes");
  });
});

describe("Accept-Language matching", () => {
  it("takes the highest-quality language we speak", () => {
    expect(matchAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(matchAcceptLanguage("de,en-GB;q=0.7")).toBe("en");
    expect(matchAcceptLanguage("sw-KE")).toBe("sw");
    expect(matchAcceptLanguage("yo-NG,en;q=0.5")).toBe("yo");
  });

  it("ignores a language offered at q=0", () => {
    expect(matchAcceptLanguage("fr;q=0")).toBeNull();
  });

  it("returns null when it knows none of them", () => {
    expect(matchAcceptLanguage("de,nl;q=0.8")).toBeNull();
    expect(matchAcceptLanguage("")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});
