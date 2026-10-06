import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_FONT_FILES } from "@/lib/pdf-font";

/**
 * The guard on the bug this font exists to fix.
 *
 * A church in Nigeria downloaded a giving report and read `¦3,659,040.00`.
 * The cause was Helvetica: a PDF's built-in fonts are WinAnsi-encoded, a
 * 256-character set with no ₦ in it, so the symbol came out as whatever sits
 * at that byte. Nothing threw. The figure was simply wrong on the page a
 * treasurer hands to a board.
 *
 * Embedding Noto Sans fixed it, and these tests keep it fixed. They read the
 * actual .ttf files in public/fonts and check the character map, so swapping
 * the font, truncating a file in a bad deploy, or adding a symbol the font
 * does not carry all fail here rather than in somebody's download.
 */

/** Characters the PDFs put on a page, and must therefore be able to draw. */
const MUST_RENDER: [string, string][] = [
  ["₦", "Naira — the one that broke"],
  ["₵", "Ghana cedi"],
  ["£", "pound"],
  ["€", "euro"],
  ["$", "dollar"],
  ["—", "em dash, used for an empty cell"],
  ["·", "middle dot, the separator in the footer"],
  ["’", "curly apostrophe in church names"],
  ["é", "Latin-1 accents in names"],
  ["ṣ", "Yoruba dot-below, Latin Extended Additional"],
  ["à", "French-language churches"],
];

/**
 * Noto Sans has no arrows, so `→` draws an empty box — silently, the way the
 * Naira sign did. The summary report used to print `member_id → members.id`
 * on a page meant for a pastor; both the jargon and the arrow are gone, and
 * this list keeps them from coming back by another route.
 */
const MUST_NOT_APPEAR = ["→", "←", "⇒", "✓", "✗", "•"];

/** Minimal TrueType cmap reader — formats 4 and 12, which is all Noto uses. */
function codePoints(file: string): Set<number> {
  const b = readFileSync(file);
  const tables = b.readUInt16BE(4);
  let cmap: number | null = null;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("ascii", rec, rec + 4) === "cmap") cmap = b.readUInt32BE(rec + 8);
  }
  if (cmap === null) throw new Error(`${file} has no cmap table — not a usable font`);

  const out = new Set<number>();
  const subtables = b.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const off = cmap + b.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = b.readUInt16BE(off);
    if (format === 4) {
      const segX2 = b.readUInt16BE(off + 6);
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(off + 14 + s * 2);
        const start = b.readUInt16BE(off + 16 + segX2 + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const go = off + 16 + g * 12;
        const start = b.readUInt32BE(go);
        const end = b.readUInt32BE(go + 4);
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

describe("the font every PDF is set in", () => {
  for (const [weight, file] of Object.entries(PDF_FONT_FILES)) {
    describe(weight, () => {
      it("is on disk and is a whole file, not a Git-LFS pointer or a 404 page", () => {
        expect(statSync(file).size).toBeGreaterThan(100_000);
        expect(readFileSync(file).subarray(0, 4).toString("hex")).toMatch(
          /^(00010000|74727565|4f54544f)$/,
        );
      });

      const supported = codePoints(file);

      for (const [char, why] of MUST_RENDER) {
        it(`can draw ${char} (${why})`, () => {
          expect(supported.has(char.codePointAt(0)!)).toBe(true);
        });
      }
    });
  }

  it("has no arrows, so nothing a PDF prints may use one", () => {
    const supported = codePoints(PDF_FONT_FILES.regular);

    /*
     * Comments go first. This file and pdf-font.ts both explain the rule by
     * showing the character, and a test that cannot tell an example from an
     * instruction is a test people learn to switch off.
     */
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const pdfSource = readdirSync(join(import.meta.dirname))
      .filter((f) => /pdf.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => strip(readFileSync(join(import.meta.dirname, f), "utf8")))
      .join("\n");

    for (const char of MUST_NOT_APPEAR) {
      // Stated as a fact about the font first, so a future font that DOES
      // carry the character makes this fail loudly rather than quietly lying.
      if (supported.has(char.codePointAt(0)!)) continue;
      expect(
        pdfSource.includes(char),
        `${char} is not in the embedded font, so it draws as an empty box. Use words, or "->".`,
      ).toBe(false);
    }
  });
});
