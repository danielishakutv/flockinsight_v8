/**
 * An assistant answer, as blocks a PDF can draw. Pure and client-safe.
 *
 * The page renders answers with react-markdown (AssistantAnswer), which a PDF
 * cannot use, and the markdown libraries behind it are not dependencies we can
 * import under pnpm. So this is a small line parser for the subset the model
 * actually writes: headings, paragraphs, bullet and numbered lists, bold,
 * GFM tables, links, the odd code fence and rule. Anything it does not
 * recognise comes out as plain text, never dropped, so a PDF can be plainer
 * than the page but never says less.
 *
 * It follows what the page shows rather than what markdown could mean:
 *
 *   - links keep their words, and a same-site path is printed after them in
 *     brackets, because a printed page has no hover. A link the page would
 *     not have made clickable (safeAssistantHref says no) prints its words
 *     alone, so a PDF cannot carry an address the page refused to show.
 *   - images print nothing, as on the page.
 *   - emphasis is plain text. The PDF font has no italic face (pdf-font.ts:
 *     an italic style throws at render), so *this* and _this_ lose their
 *     markers rather than their words.
 *   - raw HTML stays literal text, which is what react-markdown without
 *     rehype-raw shows too.
 *
 * pdfSafeText is the other half: the characters Noto Sans cannot draw.
 */

import { safeAssistantHref } from "./shared";

export type MdSpan = { text: string; bold: boolean };
export type MdAlign = "left" | "center" | "right" | null;
/** One list line. `marker` is what to print: "-" or "3.". */
export type MdListItem = { depth: number; marker: string; spans: MdSpan[] };

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3; spans: MdSpan[] }
  | { kind: "paragraph"; spans: MdSpan[] }
  | { kind: "list"; items: MdListItem[] }
  | { kind: "table"; align: MdAlign[]; header: MdSpan[][]; rows: MdSpan[][][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

/** Deeper than this is printed at this depth: an A4 column runs out of room, not meaning. */
export const MAX_LIST_DEPTH = 3;
/** Quotes inside quotes inside quotes are flattened past this, so a hostile answer cannot recurse for ever. */
const MAX_QUOTE_DEPTH = 4;

/* ============================================================
 * Characters the PDF font cannot draw
 * ========================================================== */

/*
 * Noto Sans has no arrows, no check marks, no geometric shapes and no emoji,
 * and a character it lacks draws as an empty box with no error (pdf-font.ts).
 * pdf-font.test.ts keeps them out of our own source, but an answer is written
 * by a model at run time, and models are fond of exactly these. So each
 * common one becomes the words or ASCII a person would have typed, and the
 * rest are removed: a missing arrow reads better than a box.
 *
 * Written as escapes, with the name beside each, so this file never shows
 * the glyphs it is replacing and the invisible ones cannot be lost or mangled
 * by an editor.
 */
const REPLACEMENTS: Record<string, string> = {
  "\u2192": "->", // rightwards arrow
  "\u2190": "<-", // leftwards arrow
  "\u21D2": "=>", // rightwards double arrow
  "\u21D0": "<=", // leftwards double arrow
  "\u2194": "<->", // left right arrow
  "\u21D4": "<=>", // left right double arrow
  "\u27F6": "->", // long rightwards arrow
  "\u27F5": "<-", // long leftwards arrow
  "\u279C": "->", // heavy round-tipped rightwards arrow
  "\u2794": "->", // heavy wide-headed rightwards arrow
  "\u27A1": "->", // black rightwards arrow (the emoji one)
  "\u2B05": "<-", // leftwards black arrow
  "\u21E8": "->", // rightwards white arrow
  "\u25B6": "->", // black right-pointing triangle
  "\u25BA": "->", // black right-pointing pointer
  "\u25B8": "->", // black right-pointing small triangle
  "\u25C0": "<-", // black left-pointing triangle
  // Trend arrows, as in "attendance (up) 12%".
  "\u2191": "up", // upwards arrow
  "\u2193": "down", // downwards arrow
  "\u2197": "up", // north east arrow
  "\u2198": "down", // south east arrow
  "\u2B06": "up", // upwards black arrow
  "\u2B07": "down", // downwards black arrow
  // Bullets of every shape. U+2022 is in the font, but the PDFs print "-"
  // for a bullet everywhere, and a line that starts with one is a list item.
  "\u2022": "-", // bullet
  "\u2023": "-", // triangular bullet
  "\u2043": "-", // hyphen bullet
  "\u2219": "-", // bullet operator
  "\u25CF": "-", // black circle
  "\u25CB": "-", // white circle
  "\u25E6": "-", // white bullet
  "\u25A0": "-", // black square
  "\u25A1": "-", // white square
  "\u25AA": "-", // black small square
  "\u25AB": "-", // white small square
  "\u25C6": "-", // black diamond
  "\u25C7": "-", // white diamond
  // Ticks and crosses.
  "\u2713": "yes", // check mark
  "\u2714": "yes", // heavy check mark
  "\u2705": "yes", // white heavy check mark (the emoji one)
  "\u2611": "yes", // ballot box with check
  "\u2717": "no", // ballot x
  "\u2718": "no", // heavy ballot x
  "\u2716": "no", // heavy multiplication x
  "\u274C": "no", // cross mark (the emoji one)
  "\u2612": "no", // ballot box with x
  // Comparisons a figure can come with.
  "\u2264": "<=", // less-than or equal to
  "\u2265": ">=", // greater-than or equal to
  "\u2260": "!=", // not equal to
  "\u2248": "~", // almost equal to
  /*
   * Stars are deliberately absent. As "*" they would be read back as
   * markdown (a row of them is a rule, two pairs are bold), so they are
   * simply removed with the other symbols below.
   */
};

const REPLACEABLE = new RegExp(`[${Object.keys(REPLACEMENTS).join("")}]`, "g");

/*
 * Roman numerals (U+2160-U+217F) are letters to a reader but not to the
 * font, which has none of them. Their compatibility form is the ASCII a
 * person would have typed: the numeral twelve becomes "XII".
 */
const ROMAN_NUMERAL = /[\u2160-\u217F]/g;

/*
 * What is left after the replacements and still cannot be drawn, read from
 * the font's own character map (assistant-pdf.test.ts checks every code
 * point from U+2000 to U+2BFF against both weights, so a gap here fails
 * there rather than in somebody's download):
 *
 *   U+2190-U+2BFF except U+2212  arrows, mathematical operators, technical
 *                                symbols, enclosed numbers, box drawing,
 *                                shapes, symbols, dingbats. The font carries
 *                                none of them except the minus sign.
 *   U+2180-U+218F, but not       archaic Roman numerals. The three the font
 *   U+2183, U+2184, U+2189       does carry (a letter pair and a fraction)
 *                                stay.
 *   U+20C1-U+20FF                currency signs newer than the font, and the
 *                                combining marks for symbols (the keycap in
 *                                a numbered emoji).
 *   U+2065 U+2072 U+2073 U+208F  unassigned gaps in the punctuation and
 *   U+209D-U+209F                super- and subscript blocks.
 *   U+202A-U+202E U+2066-U+2069  bidirectional overrides and isolates. The
 *                                font has them, but they reorder the text
 *                                around them, so a printed path could read
 *                                differently from the one the page linked.
 *   U+FE00-U+FE0F, U+200D        variation selectors and the zero-width
 *                                joiner: the glue emoji are assembled with.
 *   U+3030 U+303D U+3297 U+3299  the four emoji outside those blocks.
 *   U+D800-U+DFFF                any surrogate, i.e. anything past the BMP:
 *                                emoji, flags, pictographs.
 *   U+E000-U+F8FF                private use, which no font agrees on.
 *
 * Control characters other than the newline go too (CONTROL, separately,
 * because it needs the unicode flag and the surrogate range must not have it).
 *
 * The copyright, registered and trademark signs are emoji too, by Unicode's
 * reckoning, but the font draws them, so they are deliberately not here.
 * Letters of scripts the font lacks are not here either: a box where a word
 * was at least says that a word was there, and removing it would not.
 */
const UNDRAWABLE =
  /[\u2190-\u2211\u2213-\u2BFF\u2180-\u2182\u2185-\u2188\u218A-\u218F\u20C1-\u20FF\u2065\u2072\u2073\u208F\u209D-\u209F\u202A-\u202E\u2066-\u2069\uFE00-\uFE0F\u200D\u3030\u303D\u3297\u3299\uD800-\uDFFF\uE000-\uF8FF]/g;
const CONTROL = /(?!\n)\p{Cc}/gu;

const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * Text made safe for the PDF font: the arrows, bullets, ticks and comparison
 * signs Noto Sans lacks become ASCII or words, and emoji and every other
 * symbol it cannot draw are removed. Newlines are kept (a Unicode line or
 * paragraph separator becomes one); tabs become a space. A word replacement
 * next to a letter or digit gets a space, so a tick before "Done" reads
 * "yes Done", not "yesDone".
 */
export function pdfSafeText(s: string): string {
  return s
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .replace(REPLACEABLE, (ch: string, at: number, all: string) => {
      const out = REPLACEMENTS[ch] ?? "";
      if (!/^[a-z]/i.test(out)) return out;
      const before = at > 0 && WORDLIKE.test(all[at - 1]) ? " " : "";
      const after = at + 1 < all.length && WORDLIKE.test(all[at + 1]) ? " " : "";
      return `${before}${out}${after}`;
    })
    .replace(ROMAN_NUMERAL, (ch: string) => ch.normalize("NFKC"))
    .replace(UNDRAWABLE, "")
    .replace(CONTROL, "");
}

/* ============================================================
 * Inline: bold, links, code spans
 * ========================================================== */

/*
 * Text that must come out exactly as written (code spans, escaped
 * characters, the "(path)" after a link) is swapped for a placeholder before
 * the emphasis rules run, so an underscore in a path or an asterisk in code
 * is never read as markup, and put back at the end. The placeholders are
 * private-use characters, which are removed from the input first, so a
 * placeholder can only be one this function made.
 */
const KEEP_OPEN = "\uE000";
const KEEP_CLOSE = "\uE001";
const KEPT = /\uE000(\d+)\uE001/g;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;

/** Bold, possibly spanning a code span or a link. `__` inside a word is not bold (snake__case). */
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;

function stripEmphasis(text: string): string {
  return text
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1$2");
}

/**
 * One line (or a joined paragraph) of markdown as bold and plain runs, with
 * links, code and emphasis resolved to the text a reader sees.
 */
export function inlineSpans(src: string): MdSpan[] {
  const kept: string[] = [];
  const keep = (s: string) => `${KEEP_OPEN}${kept.push(s) - 1}${KEEP_CLOSE}`;
  const restore = (s: string) => s.replace(KEPT, (_m, i: string) => kept[Number(i)] ?? "");

  let s = src.replace(PRIVATE_USE, "");
  // Code first: nothing inside a code span is markup, not even a backslash.
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, body: string) =>
    keep(body.trim() === "" ? body : body.trim()),
  );
  // A backslash before punctuation means the character itself.
  s = s.replace(/\\([!-/:-@[-`{-~])/g, (_m, c: string) => keep(c));
  // Images show nothing on the page, so nothing here.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // <https://...> shows its address as text on the page (it is not a safe link).
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (_m, url: string) => keep(url));
  // A destination may hold one level of balanced brackets, as in markdown.
  s = s.replace(
    /\[([^[\]]*)\]\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))*)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    (_m, label: string, href: string) => {
      const safe = safeAssistantHref(href);
      if (!safe) return label;
      if (label.trim() === "" || label.trim() === safe) return keep(safe);
      return `${label}${keep(` (${safe})`)}`;
    },
  );
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  // Bold and italic together is just bold: there is no italic face.
  s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, "**$2**");

  const spans: MdSpan[] = [];
  const push = (raw: string, bold: boolean) => {
    const text = restore(stripEmphasis(raw));
    if (!text) return;
    const prev = spans[spans.length - 1];
    if (prev && prev.bold === bold) prev.text += text;
    else spans.push({ text, bold });
  };

  let from = 0;
  for (const m of s.matchAll(BOLD)) {
    const at = m.index ?? 0;
    if (at < from) continue;
    if (m[1] === "__") {
      const before = s[at - 1] ?? "";
      const after = s[at + m[0].length] ?? "";
      if (WORDLIKE.test(before) || WORDLIKE.test(after)) continue;
    }
    push(s.slice(from, at), false);
    push(m[2], true);
    from = at + m[0].length;
  }
  push(s.slice(from), false);
  return spans;
}

/** The words of some spans, without the formatting. */
export function spansText(spans: readonly MdSpan[]): string {
  return spans.map((s) => s.text).join("");
}

/* ============================================================
 * Blocks
 * ========================================================== */

const BLANK = /^\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^( *)([-*+\u2022]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const SETEXT_1 = /^ {0,3}=+[ \t]*$/;
const SETEXT_2 = /^ {0,3}-+[ \t]*$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isListItem(line: string): boolean {
  return LIST.test(line) && !RULE.test(line);
}

/** Cells of a table row. A leading and trailing pipe are optional; `\|` is a pipe inside a cell. */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "\\" && t[k + 1] === "|") {
      cur += "|";
      k++;
    } else if (t[k] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += t[k];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function hasPipe(line: string): boolean {
  return /(^|[^\\])\|/.test(line);
}

function isDelimiterRow(line: string): boolean {
  if (!hasPipe(line) || !line.includes("-")) return false;
  return splitRow(line).every((c) => /^:?-+:?$/.test(c));
}

/** A GFM table starts with a row whose cell count matches the delimiter row under it. */
function isTableStart(lines: readonly string[], i: number): boolean {
  if (i + 1 >= lines.length || !hasPipe(lines[i]) || !isDelimiterRow(lines[i + 1])) return false;
  return splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

/**
 * Whether line i starts a block of its own, and so ends the paragraph above
 * it. A numbered item interrupts a paragraph only when it is "1." (as in
 * CommonMark), so "2024. was a good year" on a wrapped line stays prose.
 */
function startsBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  if (FENCE.test(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  if (isTableStart(lines, i)) return true;
  const m = LIST.exec(line);
  if (m && m[3] !== undefined && m[3].trim() !== "") {
    return !/^\d/.test(m[2]) || parseInt(m[2], 10) === 1;
  }
  return false;
}

/**
 * Lines of one paragraph as one string. A line ending in a backslash or two
 * spaces is a hard break, as in markdown; an empty entry is a paragraph break
 * inside a list item. Everything else joins with a space.
 */
function joinLines(lines: readonly string[]): string {
  let out = "";
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (raw.trim() === "") {
      if (out && !out.endsWith("\n")) out += "\n";
      continue;
    }
    const hard = /(\\| {2,})$/.test(raw) && k < lines.length - 1;
    const line = raw.trim().replace(/\\$/, "");
    out += line;
    if (k < lines.length - 1 && lines[k + 1].trim() !== "") out += hard ? "\n" : " ";
  }
  return out.trim();
}

function hasWords(spans: readonly MdSpan[]): boolean {
  return spansText(spans).trim() !== "";
}

function alignOf(cell: string): MdAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

function parseLines(lines: readonly string[], quoteDepth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith(mark[0].repeat(mark.length)) && /^([`~])\1*$/.test(t)) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const text = body.join("\n").replace(/\s+$/, "");
      if (text) blocks.push({ kind: "code", text });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const spans = inlineSpans(atx[2] ?? "");
      const level = Math.min(atx[1].length, 3) as 1 | 2 | 3;
      if (hasWords(spans)) blocks.push({ kind: "heading", level, spans });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      if (quoteDepth < MAX_QUOTE_DEPTH) blocks.push(...parseLines(inner, quoteDepth + 1));
      else {
        const spans = inlineSpans(joinLines(inner));
        if (hasWords(spans)) blocks.push({ kind: "paragraph", spans });
      }
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const width = header.length;
      const rows: MdSpan[][][] = [];
      i += 2;
      while (i < lines.length && !BLANK.test(lines[i]) && hasPipe(lines[i]) && !isTableStart(lines, i)) {
        // GFM: extra cells are dropped, missing ones are empty.
        const cells = splitRow(lines[i]).slice(0, width);
        while (cells.length < width) cells.push("");
        rows.push(cells.map(inlineSpans));
        i++;
      }
      blocks.push({ kind: "table", align, header: header.map(inlineSpans), rows });
      continue;
    }

    if (isListItem(line)) {
      const parsed = parseList(lines, i);
      if (parsed.block.items.length > 0) blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    // A paragraph, which may turn out to be a setext heading.
    const buf: string[] = [line];
    let heading: 1 | 2 | null = null;
    i++;
    while (i < lines.length && !BLANK.test(lines[i])) {
      if (SETEXT_1.test(lines[i])) {
        heading = 1;
        i++;
        break;
      }
      if (SETEXT_2.test(lines[i])) {
        heading = 2;
        i++;
        break;
      }
      if (startsBlock(lines, i)) break;
      buf.push(lines[i]);
      i++;
    }
    const spans = inlineSpans(joinLines(buf));
    if (!hasWords(spans)) continue;
    blocks.push(heading ? { kind: "heading", level: heading, spans } : { kind: "paragraph", spans });
  }

  return blocks;
}

/**
 * A run of list items, nested by indentation. Numbering follows markdown: a
 * numbered list counts on from its first number whatever the later items
 * say, so "1. 1. 1." prints 1, 2, 3 as it does on the page.
 */
function parseList(lines: readonly string[], start: number): { block: Extract<MdBlock, { kind: "list" }>; next: number } {
  const raw: { depth: number; marker: string; lines: string[] }[] = [];
  const indents: number[] = [];
  const counters: (number | null)[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const m = isListItem(line) ? LIST.exec(line) : null;

    if (m) {
      const indent = m[1].length;
      if (indents.length === 0) indents.push(indent);
      else {
        while (indents.length > 1 && indent < indents[indents.length - 1] - 1) indents.pop();
        if (indent >= indents[indents.length - 1] + 2) indents.push(indent);
      }
      const level = indents.length - 1;
      // Numbering below this level starts again next time.
      counters.length = level + 1;

      let marker = "-";
      if (/^\d/.test(m[2])) {
        const prev = counters[level];
        const n = typeof prev === "number" ? prev : parseInt(m[2], 10);
        counters[level] = n + 1;
        marker = `${n}.`;
      } else {
        counters[level] = null;
      }
      raw.push({ depth: Math.min(level, MAX_LIST_DEPTH), marker, lines: [m[3] ?? ""] });
      i++;
      continue;
    }

    if (BLANK.test(line)) {
      // A blank line inside a list: it goes on if what follows is another
      // item or an indented continuation, and ends otherwise.
      let j = i + 1;
      while (j < lines.length && BLANK.test(lines[j])) j++;
      if (j < lines.length && (isListItem(lines[j]) || (indentOf(lines[j]) >= 2 && !startsOwnBlock(lines, j)))) {
        if (!isListItem(lines[j])) raw[raw.length - 1]?.lines.push("");
        i = j;
        continue;
      }
      break;
    }

    // Anything that is a block of its own ends the list, indented or not:
    // a table or a fence under an item prints as a table or a fence.
    if (startsOwnBlock(lines, i)) break;
    raw[raw.length - 1]?.lines.push(line);
    i++;
  }

  const items: MdListItem[] = [];
  for (const r of raw) {
    const spans = inlineSpans(joinLines(r.lines));
    if (hasWords(spans)) items.push({ depth: r.depth, marker: r.marker, spans });
  }
  return { block: { kind: "list", items }, next: i };
}

/** Inside a list: headings, fences, quotes, rules and tables end it. */
function startsOwnBlock(lines: readonly string[], i: number): boolean {
  const t = lines[i].trimStart();
  return FENCE.test(t) || ATX.test(t) || QUOTE.test(t) || RULE.test(t) || isTableStart(lines, i);
}

/**
 * An answer's markdown as blocks. Run pdfSafeText over the text first when
 * the blocks are for a PDF: it turns a "\u2022" line into a "-" line, which this
 * then reads as the list item the writer meant.
 */
export function markdownBlocks(markdown: string): MdBlock[] {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\t+/, (t) => "    ".repeat(t.length)));
  return parseLines(lines, 0);
}
