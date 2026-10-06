import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * The font every FlockInsight PDF is set in, and the reason it is not
 * Helvetica.
 *
 * Helvetica is one of the fourteen fonts a PDF reader is required to have, so
 * it needs no embedding and react-pdf uses it by default. The catch is its
 * encoding: the standard fonts are WinAnsi, a 256-character set from 1985 that
 * has £ and € but no ₦. A church in Lagos downloading a giving report got
 *
 *     ¦3,659,040.00
 *
 * — the broken-bar character that sits at the Naira sign's byte — on every
 * figure in every money PDF the platform produces. Nothing errored; the symbol
 * simply was not in the font. ₵ (Ghana), ₨ and every non-Latin-1 letter in a
 * member's name failed the same way.
 *
 * So we embed. Noto Sans carries the currency block, Latin Extended, Greek,
 * Cyrillic and Vietnamese, which covers every currency in `lib/money.ts` that
 * has a symbol and every name our country profiles can produce. The two files
 * are ~550KB each and are embedded subset-wise by pdfkit, so the PDFs
 * themselves only grow by the glyphs actually used.
 *
 * ONE THING TO KNOW BEFORE YOU TYPE A SYMBOL INTO A PDF: Noto Sans has no
 * arrows. `→` (U+2192) renders as an empty box, not as an error. Use "->", or
 * a word. `—` `·` `’` `₦` `₵` `£` `€` are all present.
 * `src/lib/pdf-font.test.ts` holds that line: it reads the embedded files and
 * fails if a character the PDFs use is missing from them.
 */

/** The family name every PDF stylesheet asks for. */
export const PDF_FONT = "Noto Sans";

/** Where the files live, relative to the project root. */
export const PDF_FONT_DIR = join(process.cwd(), "public", "fonts");

export const PDF_FONT_FILES = {
  regular: join(PDF_FONT_DIR, "NotoSans-Regular.ttf"),
  bold: join(PDF_FONT_DIR, "NotoSans-Bold.ttf"),
} as const;

/*
 * Italic is deliberately NOT registered.
 *
 * react-pdf's font resolution throws when a style has no source — a stray
 * `fontStyle: "italic"` would turn a working download into a 500 rather than
 * quietly falling back. One file fewer in the repo, and the one place that
 * used italic now uses colour instead. If italic is ever genuinely wanted,
 * add NotoSans-Italic.ttf here AND to the test, don't just set the style.
 */

let registered = false;

/**
 * Register the family, once per process.
 *
 * Called at module load by `lib/pdf-chrome`, so importing any PDF module is
 * enough — no renderer has to remember to call it.
 */
export function registerPdfFonts(): void {
  if (registered) return;

  for (const [weight, file] of Object.entries(PDF_FONT_FILES)) {
    if (!existsSync(file)) {
      /*
       * Loud, not silent. A missing font file means every PDF on the platform
       * either throws at render time or silently reverts to the Naira bug this
       * module exists to fix, and the deploy that caused it would otherwise
       * look clean. See the global rule: no silent failures.
       */
      throw new Error(
        `PDF font missing: ${file} (${weight}). public/fonts must ship with the build — ` +
          `check that the deploy copies public/ and that the .ttf files were committed.`,
      );
    }
  }

  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: PDF_FONT_FILES.regular, fontWeight: 400 },
      { src: PDF_FONT_FILES.bold, fontWeight: 700 },
    ],
  });

  registered = true;
}
