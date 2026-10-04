/**
 * Where our QR encoder and a reference encoder disagree, module by module.
 *
 * `encode.test.ts` tells you THAT a symbol is wrong. It cannot tell you where,
 * because a 2,000-character diff of hashes and dots is unreadable, and the
 * answer to "which part of the pipeline is broken" is entirely in the
 * coordinates: mismatches confined to the two 3×6 version blocks are a
 * version-information bug, mismatches spread through the data region are an
 * interleaving or masking bug, and a handful around a 5×5 ring is an alignment
 * pattern in the wrong place.
 *
 * So this groups every differing module by what that module is FOR, which
 * narrows a failing test to one function in about a second.
 *
 *   pnpm tsx scripts/check-qr-encoder.ts                 # versions 1..40, all levels
 *   pnpm tsx scripts/check-qr-encoder.ts --version 7     # one version, verbose
 *   pnpm tsx scripts/check-qr-encoder.ts --version 7 --print
 *
 * `qrcode` is a dev dependency used only by this script and the tests — see
 * the header of `src/lib/qr/encode.test.ts` for why the comparison forces the
 * mask and keeps to single-mode payloads.
 */
import QRCode from "qrcode";
import { encodeQr } from "@/lib/qr/encode";
import { EC_LEVELS, blockPlan, type EcLevel } from "@/lib/qr/tables";

const ROLE_NAME = [
  "data",
  "finder",
  "separator",
  "timing",
  "alignment",
  "format",
  "version",
];

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const ONLY_VERSION = flag("version") ? Number(flag("version")) : null;
const PRINT = args.includes("--print");
const MASK = flag("mask") ? Number(flag("mask")) : 3;

/** Lowercase only: every character forces byte mode, so neither encoder can
 *  split the payload into segments the other would not. */
function payload(codewords: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < Math.max(1, codewords - 4); i++) out += alphabet[i % 26];
  return out;
}

type Finding = { version: number; level: EcLevel; byRole: Map<number, number>; examples: string[] };

function compare(version: number, level: EcLevel): Finding | null {
  const text = payload(blockPlan(version, level).dataCodewords);
  const got = encodeQr(text, {
    ecLevel: level,
    minVersion: version,
    maxVersion: version,
    mask: MASK,
  });
  if (!got.ok) {
    return {
      version,
      level,
      byRole: new Map(),
      examples: [`our encoder refused: ${got.error}`],
    };
  }
  const s = got.symbol;
  const qr = QRCode.create(text, {
    errorCorrectionLevel: level,
    version,
    maskPattern: MASK as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
  });
  const size = qr.modules.size;
  if (size !== s.size) {
    return {
      version,
      level,
      byRole: new Map(),
      examples: [`size ${s.size} vs reference ${size}`],
    };
  }

  const byRole = new Map<number, number>();
  const examples: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mine = s.modules[y * size + x];
      const theirs = qr.modules.data[y * size + x] ? 1 : 0;
      if (mine === theirs) continue;
      const role = s.roles[y * size + x];
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
      if (examples.length < 12) {
        examples.push(`(${x},${y}) ${ROLE_NAME[role]} ours=${mine} theirs=${theirs}`);
      }
    }
  }
  if (byRole.size === 0) return null;

  if (PRINT) {
    for (let y = 0; y < size; y++) {
      let ours = "";
      let theirs = "";
      for (let x = 0; x < size; x++) {
        ours += s.modules[y * size + x] ? "██" : "  ";
        theirs += qr.modules.data[y * size + x] ? "██" : "  ";
      }
      console.log(`${ours}   ${theirs}`);
    }
  }

  return { version, level, byRole, examples };
}

const versions = ONLY_VERSION ? [ONLY_VERSION] : Array.from({ length: 40 }, (_, i) => i + 1);
const findings: Finding[] = [];

for (const version of versions) {
  for (const level of EC_LEVELS) {
    const f = compare(version, level);
    if (f) findings.push(f);
  }
}

if (findings.length === 0) {
  const scope = ONLY_VERSION ? `version ${ONLY_VERSION}` : "all 40 versions";
  console.log(`\n  Identical to the reference encoder across ${scope}, every level, mask ${MASK}.\n`);
  process.exit(0);
}

console.log(`\n  ${findings.length} configuration(s) differ from the reference encoder.\n`);
for (const f of findings) {
  const total = [...f.byRole.values()].reduce((a, b) => a + b, 0);
  const roles = [...f.byRole]
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${ROLE_NAME[r]}=${n}`)
    .join(" ");
  console.log(`  version ${f.version} level ${f.level}: ${total} modules differ  [${roles}]`);
  for (const e of f.examples) console.log(`      ${e}`);
}
console.log("");
process.exit(1);
