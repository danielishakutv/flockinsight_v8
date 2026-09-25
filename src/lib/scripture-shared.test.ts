import { describe, expect, it } from "vitest";
import {
  BOOKS,
  findBook,
  parseReference,
  QUICK_VERSES,
  suggestBooks,
  TRANSLATIONS,
  translationShort,
} from "@/lib/scripture-shared";

describe("the book list", () => {
  it("has all 66 books, once each", () => {
    expect(BOOKS).toHaveLength(66);
    expect(new Set(BOOKS.map((b) => b.name)).size).toBe(66);
  });

  it("gives every book a sane chapter count", () => {
    for (const b of BOOKS) {
      expect(b.chapters, b.name).toBeGreaterThan(0);
      expect(b.chapters, b.name).toBeLessThanOrEqual(150);
    }
    expect(BOOKS.find((b) => b.name === "Psalms")?.chapters).toBe(150);
    expect(BOOKS.find((b) => b.name === "Jude")?.chapters).toBe(1);
  });

  it("resolves the names people actually type", () => {
    const cases: [string, string][] = [
      ["john", "John"],
      ["JOHN", "John"],
      ["Jn", "John"],
      ["1 john", "1 John"],
      ["1John", "1 John"],
      ["ijohn", "1 John"],
      ["I John", "1 John"],
      ["first john", "1 John"],
      ["iii john", "3 John"],
      ["Ps", "Psalms"],
      ["psalm", "Psalms"],
      ["Song of Songs", "Song of Solomon"],
      ["Revelations", "Revelation"],
      ["s.o.s", "Song of Solomon"],
    ];
    for (const [input, expected] of cases) {
      expect(findBook(input)?.name, input).toBe(expected);
    }
  });

  it("refuses a prefix that could be two books", () => {
    // "Ph" is Philippians or Philemon — guessing would put the wrong passage
    // on a screen in front of a congregation.
    expect(findBook("Ph")).toBeNull();
    expect(findBook("Philipp")?.name).toBe("Philippians");
    expect(findBook("Philem")?.name).toBe("Philemon");
  });

  it("knows nothing about books that do not exist", () => {
    expect(findBook("Hezekiah")).toBeNull();
    expect(findBook("")).toBeNull();
  });
});

describe("parsing a reference", () => {
  const ok = (input: string) => {
    const r = parseReference(input);
    if (!r.ok) throw new Error(`${input} failed: ${r.error}`);
    return r.ref;
  };

  it("handles the ordinary forms", () => {
    expect(ok("John 3:16").canonical).toBe("John 3:16");
    expect(ok("john 3.16").canonical).toBe("John 3:16");
    expect(ok("JOHN 3 16").canonical).toBe("John 3:16");
    expect(ok("Jn3:16").canonical).toBe("John 3:16");
    expect(ok("  john   3 : 16  ").canonical).toBe("John 3:16");
  });

  it("handles ranges, including the dash people paste from the web", () => {
    expect(ok("John 3:16-18").canonical).toBe("John 3:16-18");
    expect(ok("John 3:16–18").canonical).toBe("John 3:16-18");
    expect(ok("John 3:16 - 18").canonical).toBe("John 3:16-18");
  });

  it("handles a whole chapter, and a book on its own", () => {
    expect(ok("Psalms 23").canonical).toBe("Psalms 23");
    expect(ok("Jude").canonical).toBe("Jude 1");
  });

  it("handles a numbered book", () => {
    expect(ok("1 John 4:8").canonical).toBe("1 John 4:8");
    expect(ok("2cor 5:17").canonical).toBe("2 Corinthians 5:17");
  });

  it("catches a chapter the book does not have", () => {
    const r = parseReference("John 25:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("21 chapters");
  });

  it("catches a backwards range", () => {
    const r = parseReference("John 3:18-16");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/before/i);
  });

  it("refuses a range too long to read off a screen", () => {
    expect(parseReference("Psalms 119:1-90").ok).toBe(false);
    expect(parseReference("Psalms 119:1-40").ok).toBe(true);
  });

  it("says something useful when the book is wrong", () => {
    const r = parseReference("Hezekiah 4:4");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Hezekiah");
  });

  it("refuses an empty box rather than guessing", () => {
    expect(parseReference("").ok).toBe(false);
    expect(parseReference("   ").ok).toBe(false);
  });
});

describe("suggestions", () => {
  it("offers books as you type", () => {
    expect(suggestBooks("phil")).toContain("Philippians");
    expect(suggestBooks("phil")).toContain("Philemon");
    expect(suggestBooks("gen")).toContain("Genesis");
  });

  it("offers nothing for nothing", () => {
    expect(suggestBooks("")).toEqual([]);
  });
});

describe("translations", () => {
  it("has no duplicates and a short label for each", () => {
    const ids = TRANSLATIONS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TRANSLATIONS) expect(translationShort(t.id)).toBe(t.short);
  });

  it("falls back to the raw id for an unknown translation", () => {
    expect(translationShort("niv")).toBe("NIV");
  });
});

describe("the quick verses", () => {
  // These are offered as one tap. A typo in this list is a broken button.
  it("every one of them parses", () => {
    for (const ref of QUICK_VERSES) {
      const r = parseReference(ref);
      expect(r.ok, `${ref}: ${r.ok ? "" : r.error}`).toBe(true);
    }
  });
});
