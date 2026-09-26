/**
 * Fields that summon the wrong keyboard on a phone.
 *
 * A church secretary entering two hundred phone numbers on a QWERTY keypad is a
 * slow, error-prone afternoon; `type="tel"` turns it into a numeric pad. The
 * same goes for an amount, an email address and a URL. This reads what each
 * field is FOR, from its id, name or placeholder, and compares that with the
 * keyboard it actually asks for.
 *
 *   node scripts/audit-input-types.mjs
 *
 * Source rather than rendered HTML: most of these live inside a dialog that
 * only exists once somebody has clicked something.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SEP = String.fromCharCode(92); // backslash
const NEWLINE = String.fromCharCode(10);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const BT = String.fromCharCode(96);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * The opening tag starting at `i`, brace- and quote-aware.
 *
 * Not a regex: attribute values hold arrow functions, and `=>` ends a `[^>]*`
 * match in the middle of an attribute.
 */
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
    if (c === DQ || c === SQ || c === BT) {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

/**
 * `inputMode` counts as much as `type`, because it is what actually chooses the
 * keypad — a field that sets it is already doing the job.
 */
const KINDS = [
  {
    what: "phone",
    hint: /phone|mobile|whatsapp|msisdn|tel/i,
    ok: /type="tel"|inputMode="tel"/,
    fix: 'type="tel"',
  },
  {
    what: "amount",
    hint: /amount|price|fee|naira|balance|target|budget|cost/i,
    ok: /type="number"|inputMode="(numeric|decimal)"/,
    fix: 'inputMode="decimal"',
  },
  { what: "email", hint: /email/i, ok: /type="email"/, fix: 'type="email"' },
  {
    what: "url",
    hint: /url|website|link/i,
    ok: /type="url"|inputMode="url"/,
    fix: 'type="url"',
  },
];

/** Already the right kind of control, or not a free-text field at all. */
const TYPED_ALREADY =
  /type="(date|time|datetime-local|month|week|file|checkbox|radio|hidden|color|range|password|search)"/;

const rows = [];
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<(Input|input)\s/g)) {
    const tag = openingTag(src, m.index);
    if (!tag) continue;
    if (TYPED_ALREADY.test(tag)) continue;

    // The honeypot on the public demo form is a text input named "website",
    // hidden from people and there to catch bots. `type="url"` would tell a bot
    // exactly what to put in it.
    if (/aria-hidden="true"/.test(tag)) continue;
    if (tag.includes("tabIndex={-1}")) continue;

    const found = /(?:\bid|\bname|\bplaceholder)="([^"]*)"/.exec(tag);
    const subject = found ? found[1] : "";
    if (!subject) continue;

    // A free-text search box lists what you may search BY — "Search by name,
    // phone or email" — and accepts any of them, so none of those keyboards is
    // the right one. An email SUBJECT is prose, not an address.
    if (/^search/i.test(subject.trim())) continue;
    if (/subject/i.test(subject)) continue;

    for (const k of KINDS) {
      if (!k.hint.test(subject)) continue;
      if (k.ok.test(tag)) break;
      const line = src.slice(0, m.index).split(NEWLINE).length;
      rows.push({
        at: file.split(SEP).join("/") + ":" + line,
        what: k.what,
        subject,
        fix: k.fix,
      });
      break;
    }
  }
}

for (const r of rows) {
  console.log("  " + r.at + "  " + r.what + " -> add " + r.fix + "   (" + r.subject + ")");
}
console.log(
  rows.length === 0
    ? "Every field asks for the right keyboard."
    : NEWLINE + rows.length + " fields with the wrong keyboard",
);
process.exit(rows.length === 0 ? 0 : 1);
