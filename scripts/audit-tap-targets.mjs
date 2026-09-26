/**
 * Every tappable icon-only control, and what is wrong with it.
 *
 * A real tag scanner rather than a regex: attribute values hold arrow functions,
 * and "=>" ends a [^>]* match in the middle of an attribute -- which is how a
 * first pass reported two buttons that do carry an aria-label.
 *
 * Source rather than rendered HTML, because most of these live inside a dialog,
 * a dropdown or a row that only exists once somebody has clicked something.
 *
 *   node scripts/audit-tap-targets.mjs
 *
 * One finding is expected and correct: the remove-photo button on a thumbnail
 * is 36px, because 44 would cover half of the photo being judged.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const SEP = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);

/** The text of the opening tag starting at `i`, brace- and quote-aware. */
function openingTag(src, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === SEP) j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === DQ || c === SQ || c === BT) { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(i, j + 1);
  }
  return null;
}
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const BT = String.fromCharCode(96);

const rows = [];
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<(Button|button|Link|a)[ \s]/g)) {
    const tag = openingTag(src, m.index);
    if (!tag) continue;
    const iconSized = /size=["{]?["']?icon/.test(tag);
    // A small circle with a transparent `after:-inset-*` around it is a 44px
    // target that only looks small, which is the right answer for a control
    // sitting inside a text field.
    const extended = /after:-inset-/.test(tag);
    const shrunk = /className="[^"]*[ ]size-(6|7|8|9)[ "]/.test(tag) && !extended;
    if (!iconSized && !shrunk) continue;
    const named = /aria-label|aria-labelledby/.test(tag);
    const titled = /[ ]title=/.test(tag);
    const line = src.slice(0, m.index).split(NEWLINE).length;
    rows.push({
      at: file.split(SEP).join("/") + ":" + line,
      iconSized,
      shrunk,
      named,
      titled,
    });
  }
}

const unnamed = rows.filter((r) => !r.named);
const small = rows.filter((r) => r.shrunk);
console.log("icon-ish controls: " + rows.length);
console.log(NEWLINE + "no aria-label (" + unnamed.length + "):");
for (const r of unnamed) console.log("  " + r.at + (r.titled ? "   (title only)" : "   (nothing)"));
console.log(NEWLINE + "under 44px on touch (" + small.length + "):");
for (const r of small) console.log("  " + r.at);
// `node scripts/audit-tap-targets.mjs out.json` also writes the raw rows.
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
