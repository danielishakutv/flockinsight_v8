#!/usr/bin/env node
/**
 * Move hardcoded English into the dictionary, and rewrite the code to ask for
 * it.
 *
 * This is the expensive half of translating an app, and the half no
 * translation API touches: a thousand strings sitting in JSX each need a key
 * invented, the markup rewritten, and the component given a `t`.
 *
 * DELIBERATELY TIMID, and it earned that the hard way. The first version
 * matched `>text<` with a regular expression and turned
 * `xhr.status >= 200 && xhr.status < 300` into a translation key, then gave
 * `useT()` to the first exported component only and broke thirteen files whose
 * strings lived in a dialog further down. Both are guarded against below. A
 * codemod that handles the easy files and mangles the interesting ones is
 * worse than none, because the interesting ones are where the strings are.
 *
 *   node scripts/extract-i18n.mjs --dir src/components/members
 *   node scripts/extract-i18n.mjs --dir src/components/members --write
 *
 * After --write, ALWAYS: pnpm exec tsc --noEmit && pnpm build && pnpm test.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EN = "src/lib/i18n/dictionaries/en.ts";
const TEXT_PROPS = ["placeholder", "title", "aria-label", "label", "alt"];

/**
 * Which hook this file may call.
 *
 * `useT()` THROWS when there is no <I18nProvider> above it. There is one at the
 * root now, so app code is safe — but a primitive under ui/ is also rendered by
 * tests, by storybook-ish one-offs, and by any tree a future layout forgets to
 * wrap. A crash is a blank page; an untranslated word is a word. So the shared
 * layers get the forgiving hook and everything else gets the strict one, which
 * is what makes a missing provider in app code a loud error rather than silent
 * English.
 */
function hookFor(rel) {
  return /src\/components\/(ui|charts)\//.test(rel) ? "useOptionalT" : "useT";
}

/** Index of the closing `}` of `export const en = { ... }`, or -1. */
function endOfEnObject(en) {
  const start = en.indexOf("export const en = {");
  if (start === -1) return -1;
  let depth = 0;
  for (let i = en.indexOf("{", start); i < en.length; i++) {
    if (en[i] === "{") depth++;
    else if (en[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Which dictionary section a file's strings belong in, from its path. */
function sectionFor(rel) {
  const m =
    rel.match(/src\/components\/([a-z-]+)\//) ||
    rel.match(/src\/app\/\(app\)\/([a-z-]+)\//);
  const raw = m ? m[1] : "common";
  return raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** A stable camelCase key from the English text. */
function keyFor(text) {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5);
  if (!words.length) return null;
  const k = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
  return /^[a-z]/.test(k) ? k : null;
}

function isNotProse(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 120) return true;
  if (!/[a-z]/i.test(t)) return true;
  if (/^(https?:|\/|#|mailto:|tel:)/.test(t)) return true;
  if (/^[A-Z0-9_]+$/.test(t)) return true;
  if (/^\d[\d\s.,:%+-]*$/.test(t)) return true;
  if (/[{}<>]/.test(t)) return true;
  // An example address or number shows the SHAPE of an answer, not a sentence.
  if (/^\S+@\S+\.\S+$/.test(t)) return true;
  if (/^[+\d][\d\s()+-]{5,}$/.test(t)) return true;
  return false;
}

/**
 * Does this look like code rather than something a person reads?
 *
 * `>` and `<` are comparison operators as well as tag delimiters, so a regular
 * expression cannot tell `>Save changes<` from `>= 200 && xhr.status <`.
 * Prose contains no `&&`, no semicolons and no method calls, and a sentence
 * does not begin with `=` or a digit.
 */
function looksLikeCode(t) {
  if (/&&|\|\||==|=>|;|\breturn\b|\bconst\b/.test(t)) return true;
  if (/\b\w+\.\w+\(/.test(t)) return true;
  if (!/^[A-Za-z"'£$€₦]/.test(t)) return true;
  /*
   * A ternary between two elements: `count > total ? <A/> : <B/>` leaves
   * " total ? " looking like a sentence. Prose writes "Sure?" against the
   * word it belongs to; only code writes " ? " with a space on both sides.
   */
  if (/ \? | : /.test(t)) return true;
  return false;
}

/**
 * Does this file already use `t` for something that is not a translator?
 *
 * `transfers.map((t) => ...)` and a module-level `const t` are both common,
 * and putting `const t = useT()` at the top of such a component does not
 * fail loudly — the inner `t` shadows it and `t("finance.transfers")` becomes
 * a call on a TransferRow. In meeting-room.tsx it collided outright.
 *
 * So the file is handed back to a person instead. A codemod that handles the
 * easy files and mangles the interesting ones is worse than none, because the
 * interesting ones are where the strings are.
 */
function bindsTElsewhere(src) {
  if (/\(\s*t\s*[,):]/.test(src)) return true; // (t) => , (t, i) => , (t: X)
  if (/\bt\s*=>/.test(src)) return true; // t => ...
  if (/\b(?:const|let|var)\s+t\s*[=:](?!\s*use\w*T\(\))/.test(src)) return true;
  return false;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Give every component in the file that uses `t(` its own `const t = useT()`.
 *
 * Walks brace depth rather than trusting a regex to find a function body,
 * because a component's strings are as often in a dialog or a row renderer
 * defined below it as in the default export.
 */
function addHooks(src, hook) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const sig = lines[i].match(/^(\s*)(?:export\s+)?function\s+[A-Z]\w*\s*\(/);
    if (!sig) continue;

    /*
     * The BODY opens at `) {`, not at any line ending in a brace.
     * `export function FormBuilder({` ends in a brace too — that is the props
     * destructuring — and treating it as the body puts `const t = useT()`
     * inside the parameter list, which is a syntax error rather than a bug you
     * find later.
     */
    let open = i;
    while (open < lines.length && !/\)\s*(?::[^{]*)?\{\s*$/.test(lines[open])) {
      open++;
      if (open - i > 60) break; // not a function we understand
    }
    if (open >= lines.length || open - i > 60) continue;
    for (let k = i + 1; k <= open; k++) out.push(lines[k]);

    let depth = 1;
    let uses = false;
    let hasOwn = false;
    for (let k = open + 1; k < lines.length && depth > 0; k++) {
      depth += (lines[k].match(/\{/g) || []).length;
      depth -= (lines[k].match(/\}/g) || []).length;
      if (/\bt\(["'`]/.test(lines[k])) uses = true;
      /*
       * ANY hook that binds `t`, not just useT. `useOptionalT` exists for a
       * component that may render outside the provider, and matching only
       * `useT` put `const t = useT()` directly above an existing
       * `const t = useOptionalT()` — a redeclaration, in the one file that had
       * already been translated by hand.
       */
      if (/const t = use\w*T\(\)/.test(lines[k])) hasOwn = true;
    }
    if (uses && !hasOwn) out.push(`${sig[1]}  const t = ${hook}();`);
    i = open;
  }
  return out.join("\n");
}

/** Insert an import after the LAST line of the import block. */
function addImport(src, line) {
  const lines = src.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import /.test(lines[i]) || /^\} from ["']/.test(lines[i])) last = i;
  }
  if (last === -1) return null;
  lines.splice(last + 1, 0, line);
  return lines.join("\n");
}

function sectionBody(en, section) {
  const m = en.match(new RegExp(`^([ \\t]*)${section}: \\{$`, "m"));
  if (!m) return null;
  const start = en.indexOf(m[0]) + m[0].length;
  const end = en.indexOf(`\n${m[1]}},`, start);
  return en.slice(start, end);
}

const args = process.argv.slice(2);
const dir = args[args.indexOf("--dir") + 1];
const write = args.includes("--write");
if (!dir || dir.startsWith("--")) {
  console.error("usage: node scripts/extract-i18n.mjs --dir <path> [--write]");
  process.exit(1);
}

const files = walk(join(ROOT, dir));
const newKeys = new Map();
const skipped = [];
let rewritten = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  let src = readFileSync(file, "utf8");
  const before = src;
  const section = sectionFor(rel);
  const isClient = /^["']use client["']/.test(src.trimStart());
  const used = new Map();

  const take = (text) => {
    const key = keyFor(text);
    if (!key) return null;
    used.set(key, text);
    return `${section}.${key}`;
  };

  /*
   * A JSX text node, and the reason this pattern is as fussy as it is.
   *
   * `>text<` on its own has no idea whether that `>` closed a tag. It matched
   * `=> Promise<void>` and rewrote a type annotation into a translation key —
   * the same failure as the first version turning
   * `xhr.status >= 200 && xhr.status < 300` into one. Both times the file
   * stopped parsing, so tsc caught it. But a codemod that needs tsc to tell it
   * what a `>` was is not timid, it is reckless.
   *
   * So: the `>` must NOT follow `=`, `!`, `-`, `<` or `>` — ruling out `=>`,
   * `!=`, `->`, `<<` and the `>>` that closes nested generics — and the `<`
   * after the text must begin a tag, `</` or `<Identifier`. Both are
   * lookarounds rather than captures, so adjacent text nodes still match the
   * way they did before.
   */
  src = src.replace(
    /(?<![=!<>\-])>([^<>{}\n]{2,118})<(?=\/|[A-Za-z])/g,
    (m, text) => {
      const t = text.trim();
      if (isNotProse(t) || looksLikeCode(t)) return m;
      const path = take(t);
      return path ? `>{t("${path}")}<` : m;
    },
  );

  for (const prop of TEXT_PROPS) {
    const re = new RegExp(`(\\b${prop}=)"([^"\\n]{2,118})"`, "g");
    src = src.replace(re, (m, lhs, text) => {
      if (isNotProse(text)) return m;
      const path = take(text.trim());
      return path ? `${lhs}{t("${path}")}` : m;
    });
  }

  src = src.replace(
    /(toast\.(?:success|error|info|warning)\(\s*)"([^"\n]{2,158})"/g,
    (m, lhs, text) => {
      if (isNotProse(text)) return m;
      const path = take(text.trim());
      return path ? `${lhs}t("${path}")` : m;
    },
  );

  if (src === before) continue;

  if (!isClient) {
    skipped.push(`${rel}: server component — needs getT() by hand`);
    continue;
  }

  if (bindsTElsewhere(src)) {
    skipped.push(`${rel}: already uses \`t\` for something else — by hand`);
    continue;
  }

  /*
   * The file needs the SYMBOL, not just the module.
   *
   * Checking only for `from "@/components/i18n-provider"` meant a file that
   * imported `useOptionalT` was treated as already having `useT`, so the hook
   * went in uncalled and undeclared. Three cases, in order: the symbol is
   * there already, the module is there and the symbol joins its braces, or
   * neither and a fresh import line goes in.
   */
  const hook = hookFor(rel);
  const importRe =
    /import \{([^}]*)\} from ["']@\/components\/i18n-provider["'];/;
  const existing = src.match(importRe);
  if (existing && !new RegExp(`\\b${hook}\\b`).test(existing[1])) {
    src = src.replace(importRe, (m, names) =>
      m.replace(names, ` ${hook},${names.replace(/^ /, " ")}`),
    );
  } else if (!existing) {
    const withImport = addImport(
      src,
      `import { ${hook} } from "@/components/i18n-provider";`,
    );
    if (!withImport) {
      skipped.push(`${rel}: no import block`);
      continue;
    }
    src = withImport;
  }

  src = addHooks(src, hook);

  if (/\bt\(["'`]/.test(src) && !/const t = use\w*T\(\)/.test(src)) {
    skipped.push(`${rel}: uses t() but no component to attach it to`);
    continue;
  }

  if (!newKeys.has(section)) newKeys.set(section, new Map());
  for (const [k, v] of used) newKeys.get(section).set(k, v);

  rewritten++;
  if (write) writeFileSync(file, src, "utf8");
  else console.log(`would rewrite  ${rel}  (${used.size} strings)`);
}

if (write && newKeys.size) {
  let en = readFileSync(join(ROOT, EN), "utf8");
  for (const [section, entries] of newKeys) {
    const body = sectionBody(en, section) ?? "";
    const lines = [...entries]
      .filter(([k]) => !new RegExp(`^\\s*${k}:`, "m").test(body))
      .map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`);
    if (!lines.length) continue;

    const m = en.match(new RegExp(`^([ \\t]*)${section}: \\{$`, "m"));
    if (m) {
      const start = en.indexOf(m[0]) + m[0].length;
      en = en.slice(0, start) + "\n" + lines.join("\n") + en.slice(start);
    } else {
      /*
       * A NEW section goes at the end of the `en` OBJECT.
       *
       * `en.lastIndexOf("};")` found the last one in the FILE, which is the
       * close of the `PartialDictionary` mapped type below `en` — so two new
       * sections were written into a type declaration as string literals
       * ("A mapped type may not declare properties or methods"), which broke
       * `Dictionary`, which broke `TKey`, which broke every t() call in the
       * run. Brace-match from `export const en` instead.
       */
      const close = endOfEnObject(en);
      if (close === -1) {
        skipped.push(`${EN}: could not find the end of the en object`);
        continue;
      }
      en =
        en.slice(0, close) +
        `\n  ${section}: {\n${lines.join("\n")}\n  },\n` +
        en.slice(close);
    }
  }
  writeFileSync(join(ROOT, EN), en, "utf8");
}

const total = [...newKeys.values()].reduce((n, m) => n + m.size, 0);
console.log(`\n${write ? "Rewrote" : "Would rewrite"} ${rewritten} files, ${total} strings.`);
if (skipped.length) {
  console.log(`\nLeft for a person (${skipped.length}):`);
  for (const s of skipped.slice(0, 40)) console.log(`  ${s}`);
}
