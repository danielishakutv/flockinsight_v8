#!/usr/bin/env node
/**
 * Dictionary keys nothing asks for any more.
 *
 * The extraction codemod only ever adds. So when a screen is rewritten — the
 * QR designer lost thirty controls — its keys stay behind in `en.ts`, and the
 * whole dictionary is handed to the browser as a prop on every page. Dead keys
 * are therefore not merely untidy: every reader downloads them, in every
 * language, for ever.
 *
 * They are also actively misleading. A smoke test that greps the rendered page
 * for "Smallest grid" to prove a control is gone finds the string in the RSC
 * payload and reports the control still there, which is how this script came
 * to exist.
 *
 *   node scripts/prune-i18n.mjs                 # report
 *   node scripts/prune-i18n.mjs --section links # one section
 *   node scripts/prune-i18n.mjs --write
 *
 * DELIBERATELY CONSERVATIVE. A key is only removed when its full dotted path
 * appears nowhere in the source as a string. Anything reached by a computed
 * key — `t(`nav.${x}`)` — is invisible to that search, so a section using one
 * is skipped entirely and named in the output rather than half-pruned.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EN = "src/lib/i18n/dictionaries/en.ts";
const WRITE = process.argv.includes("--write");
const ONLY = (() => {
  const i = process.argv.indexOf("--section");
  return i >= 0 ? process.argv[i + 1] : null;
})();

/* ------------------------------------------------------------------ files */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const SOURCES = walk(join(ROOT, "src"))
  .filter((p) => relative(ROOT, p) !== EN)
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));

const HAYSTACK = SOURCES.map((s) => s.text).join("\n");

/* ------------------------------------------------------------- the keys */

const en = readFileSync(join(ROOT, EN), "utf8");
const lines = en.split("\n");

/**
 * Walk the file by brace depth rather than parsing it.
 *
 * The dictionary is a plain nested object literal of string values, written one
 * key per line, so depth plus the nearest `section: {` is enough to know a
 * leaf's dotted path. A real parse would be more robust and this file does not
 * need one; what it does need is to leave every comment and blank line exactly
 * where it was, which a parse-and-reprint would not.
 */
const LEAF = /^\s*([A-Za-z_][\w]*)\s*:\s*(["'`])/;
const OPEN = /^\s*([A-Za-z_][\w]*)\s*:\s*\{\s*$/;

const sections = new Map(); // section -> { keys: [{ key, line }], computed: boolean }
let section = null;
let depth = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const open = OPEN.exec(line);

  if (open && depth === 1) {
    section = open[1];
    sections.set(section, { keys: [], computed: false });
    depth++;
    continue;
  }

  if (/^\s*export const en = \{\s*$/.test(line)) {
    depth = 1;
    continue;
  }

  if (/^\s*\},?\s*$/.test(line) && depth === 2) {
    section = null;
    depth = 1;
    continue;
  }

  const leaf = LEAF.exec(line);
  if (leaf && section && depth === 2) {
    sections.get(section).keys.push({ key: leaf[1], line: i });
  }
}

/* ------------------------------------------- which sections are computed */

for (const name of sections.keys()) {
  // `t(`nav.${...}`)` or a template that builds this section's path.
  const computed = new RegExp("[`\"']" + name + "\\.\\$\\{|`" + name + "\\.\\$\\{");
  if (computed.test(HAYSTACK)) sections.get(name).computed = true;
}

/* ----------------------------------------------------------- the report */

const doomed = [];
const skipped = [];

for (const [name, info] of sections) {
  if (ONLY && name !== ONLY) continue;
  if (info.computed) {
    skipped.push(`${name} (built with a template somewhere — not touched)`);
    continue;
  }
  for (const { key, line } of info.keys) {
    const path = `${name}.${key}`;
    if (!HAYSTACK.includes(path)) doomed.push({ path, line, name });
  }
}

if (doomed.length === 0) {
  console.log("\n  Every key is asked for somewhere.\n");
  for (const s of skipped) console.log(`  skipped: ${s}`);
  process.exit(0);
}

const bySection = new Map();
for (const d of doomed) {
  bySection.set(d.name, (bySection.get(d.name) ?? 0) + 1);
}

console.log(`\n  ${doomed.length} key(s) nothing asks for:\n`);
for (const [name, n] of [...bySection].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${name}`);
}
for (const s of skipped) console.log(`\n  skipped: ${s}`);

if (!WRITE) {
  console.log("\n  Re-run with --write to remove them.\n");
  process.exit(1);
}

/*
 * Removed back to front, so an earlier removal cannot shift a later line
 * number. A key whose value spans more than one line takes its continuation
 * lines with it: the codemod writes long strings as `key:\n  "…",`.
 */
const drop = new Set();
for (const { line } of doomed) {
  drop.add(line);
  // A value that continues on the following lines until one ends with `",`.
  if (!/,\s*$/.test(lines[line])) {
    for (let j = line + 1; j < lines.length; j++) {
      drop.add(j);
      if (/,\s*$/.test(lines[j])) break;
    }
  }
}

const kept = lines.filter((_, i) => !drop.has(i));
writeFileSync(join(ROOT, EN), kept.join("\n"), "utf8");
console.log(`\n  Removed ${doomed.length} key(s), ${drop.size} line(s).`);
console.log("  Now run: pnpm exec tsc --noEmit && pnpm test\n");
