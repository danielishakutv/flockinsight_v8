#!/usr/bin/env node
/**
 * Find English that a Hausa speaker would still be reading.
 *
 * The app has a working translation system, eight dictionaries and 756 keys —
 * and nineteen of three hundred and eighty-eight components actually call it.
 * So "is it translated?" has been answered by opening a page and looking,
 * which finds the heading and misses the toast, the placeholder, the empty
 * state and the button that only appears when something fails.
 *
 * This walks the church-facing app and the public site and reports every
 * user-visible string that is not going through `t()`. Superadmin is
 * deliberately excluded: one operator uses it, in English, and translating it
 * would be work that serves nobody.
 *
 *   node scripts/audit-i18n.mjs              # summary, worst files first
 *   node scripts/audit-i18n.mjs --file path  # every string in one file
 *   node scripts/audit-i18n.mjs --json
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** Where a church or a visitor reads. Superadmin is not translated on purpose. */
/*
 * All of src/app, and then subtract.
 *
 * This used to be a hand-written list naming `src/app/(marketing)` and
 * `src/app/(public)` — two route groups that do not exist here — and never
 * `src/app` itself. So the landing page, /churches, /blog, /roadmap,
 * /changelog, /privacy and /terms were outside the count entirely, and the
 * landing page alone had sixteen untranslated strings while this script
 * reported the site clean. A list of what to look at goes stale silently; a
 * list of what to skip does not.
 */
const INCLUDE = ["src/app", "src/components"];

const EXCLUDE = [
  // Daniel's own screens. English is the right answer and there are hundreds
  // of strings in there; counting them would drown the number that matters.
  "src/app/superadmin",
  "src/components/superadmin",
  "src/app/api",
  "src/components/ui", // primitives; their text comes from callers
  "src/components/charts",
];

/** Props whose value a person reads. */
const TEXT_PROPS = [
  "placeholder",
  "title",
  "aria-label",
  "label",
  "description",
  "alt",
  "heading",
  "emptyText",
  "hint",
  "subtitle",
  "confirmLabel",
  "cancelLabel",
];

/**
 * Strings that are not prose.
 *
 * Kept tight on purpose: a rule that skips too much turns this into a report
 * that always says zero, which is the failure mode of every linter nobody
 * trusts.
 */
/*
 * Halves of the wordmark, and messages thrown at developers.
 *
 * `Flock<span>Insight</span>` is branding split for its two colours — a name,
 * not prose. A "must be used within <Provider>" is an error only a developer
 * can cause and only a developer will read.
 */
const NEVER_TRANSLATED = [
  /^(Flock|Insight|FlockInsight|Toko)$/,
  /must be used within/,
];

function isNotProse(s) {
  if (NEVER_TRANSLATED.some((re) => re.test(s.trim()))) return true;
  const t = s.trim();
  /*
   * Code caught between two tags. The multi-line pass can straddle a JSX
   * ternary — `) : link.status === "active" ? (` sits between a `>` and a `<`
   * and reads as a sentence to a regex. Reporting it would teach people to
   * skim the output, which is worse than missing a string.
   */
  if (/===|!==|=>|&&|\|\||\?\s*\($|^\)\s*:/.test(t)) return true;
  if (t.length < 2) return true;
  if (!/[a-z]/i.test(t)) return true; // symbols, numbers, punctuation
  if (/^[a-z0-9_-]+$/i.test(t) && !/\s/.test(t) && t.length < 4) return true;
  if (/^(https?:|\/|#|mailto:|tel:)/.test(t)) return true; // urls and paths
  if (/^[A-Z0-9_]+$/.test(t)) return true; // CONSTANT_CASE
  if (/^\d[\d\s.,:%+-]*$/.test(t)) return true; // pure numbers
  if (/^[\p{Emoji}\s]+$/u.test(t)) return true;
  return false;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (EXCLUDE.some((e) => rel.startsWith(e))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** Strip comments and anything already inside a t() call. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/\bt\(\s*"[^"]*"(\s*,[\s\S]*?)?\)/g, "t(…)")
    .replace(/\bt\(\s*`[^`]*`(\s*,[\s\S]*?)?\)/g, "t(…)");
}

function findings(file) {
  const src = readFileSync(file, "utf8");
  const clean = strip(src);
  const lines = clean.split("\n");
  const hits = [];

  lines.forEach((line, i) => {
    /*
     * JSX text between tags: >Some words<
     *
     * The `>` must not follow `=`, `!`, `-`, `<` or `>` — otherwise `>=` in
     * `xhr.status >= 200 && xhr.status < 300` reads as the end of a tag and
     * the comparison is counted as a string somebody should translate. The
     * `<` after the text must begin a tag, `</` or `<Identifier`.
     */
    for (const m of line.matchAll(
      /(?<![=!<>\-])>([^<>{}\n]{2,120})<(?=\/|[A-Za-z])/g,
    )) {
      const text = m[1].trim();
      if (!isNotProse(text)) hits.push({ line: i + 1, kind: "text", text });
    }

    // User-visible props
    for (const prop of TEXT_PROPS) {
      const re = new RegExp(`\\b${prop}=["']([^"'\\n]{2,120})["']`, "g");
      for (const m of line.matchAll(re)) {
        const text = m[1].trim();
        if (!isNotProse(text)) hits.push({ line: i + 1, kind: prop, text });
      }
    }

    // Toasts and thrown messages — the strings people only see when it matters
    for (const m of line.matchAll(
      /\b(?:toast\.(?:success|error|info|warning)|setError|throw new Error)\(\s*["']([^"'\n]{2,160})["']/g,
    )) {
      const text = m[1].trim();
      if (!isNotProse(text)) hits.push({ line: i + 1, kind: "message", text });
    }
  });

  /*
   * JSX text that sits on its OWN line, which the per-line pass above cannot
   * see — it matches `>text<` within a single line, and prettier puts any
   * string longer than the print width on a line of its own:
   *
   *     <Label htmlFor="qr-caption" className="font-semibold">
   *       Words underneath
   *     </Label>
   *
   * `[ 	
]` rather than `[ 	]`: these files are CRLF, and a `
` sitting
   * between the tag and the newline is enough to make the whole pass find
   * nothing at all — which is exactly how it failed the first time.
   *
   * That is not a rare shape; it is what EVERY long string in this codebase
   * looks like, so the audit was blind to exactly the sentences most worth
   * translating. Found by the QR module, which reported "nothing untranslated"
   * while showing eleven English sentences.
   */
  for (const m of clean.matchAll(
    /(?<![=!<>\-])>[ \t\r]*\n\s*([^<>{}]{2,300}?)\s*\n\s*<(?=\/|[A-Za-z])/g,
  )) {
    const text = m[1].trim().replace(/\s+/g, " ");
    if (isNotProse(text)) continue;
    const line = clean.slice(0, m.index).split("\n").length;
    hits.push({ line, kind: "text", text });
  }

  return hits;
}

const args = process.argv.slice(2);
const only = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const asJson = args.includes("--json");

const files = only
  ? [join(ROOT, only)]
  : INCLUDE.flatMap((d) => walk(join(ROOT, d)));

const report = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  const hits = findings(f);
  const translated = /useT\(\)/.test(readFileSync(f, "utf8"));
  if (hits.length) report.push({ file: rel, translated, hits });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (only) {
  const r = report[0];
  if (!r) {
    console.log(`${only}: nothing untranslated found.`);
    process.exit(0);
  }
  console.log(`\n${r.file}  (${r.hits.length} strings)\n`);
  for (const h of r.hits) {
    console.log(`  ${String(h.line).padStart(4)}  [${h.kind}]  ${h.text}`);
  }
  process.exit(0);
}

const total = report.reduce((n, r) => n + r.hits.length, 0);
const partly = report.filter((r) => r.translated).length;

console.log("\nUNTRANSLATED STRINGS — church app and public site");
console.log(`Files with untranslated text: ${report.length}`);
console.log(`  of which already call t() somewhere: ${partly}`);
console.log(`Total strings: ${total}\n`);

console.log("WORST FILES");
for (const r of report.sort((a, b) => b.hits.length - a.hits.length).slice(0, 25)) {
  console.log(
    `  ${String(r.hits.length).padStart(4)}  ${r.file}${r.translated ? "  (partly done)" : ""}`,
  );
}
console.log("\nRun with --file <path> to see every string in one file.\n");
