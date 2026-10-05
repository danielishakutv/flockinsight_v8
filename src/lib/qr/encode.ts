/**
 * A QR Code encoder, from text to a grid of modules.
 *
 * WHY THIS IS WRITTEN AND NOT INSTALLED. Every QR library draws the code for
 * you — a canvas, a PNG, an SVG of black squares — and hands back a picture.
 * This module needs the opposite: the grid, plus which of its modules are
 * FUNCTION patterns and how many codewords of damage the chosen correction
 * level can repair. Without the first, every module is the same shape and the
 * finder eyes cannot be styled; without the second, a logo in the middle is a
 * guess rather than a budget. Both are internals that a library that returns a
 * picture does not expose, and the pretty part of this feature is exactly the
 * part that needs them. It is also ~400 lines of a format that has not changed
 * since 2006, runs in the browser with nothing to download, and is checked
 * against a mature encoder across all 40 versions in `encode.test.ts`.
 *
 * Scope, stated plainly: numeric, alphanumeric and byte (UTF-8) modes; no
 * Kanji mode, no micro QR, no structured append. A church encodes URLs and
 * text, both of which are byte mode.
 */

import {
  EC_FORMAT_BITS,
  EC_LEVELS,
  MAX_VERSION,
  MIN_VERSION,
  alignmentPositions,
  blockPlan,
  dataCapacityBits,
  rsDivisor,
  rsRemainder,
  sizeForVersion,
  type BlockPlan,
  type EcLevel,
} from "@/lib/qr/tables";

/* ============================================================
 * What a module is
 * ========================================================== */

/**
 * What a module is FOR, which is what lets the renderer treat it differently.
 *
 * The three big eyes, the little alignment squares and the dotted timing lines
 * are structure: a scanner locates the symbol by them, so they are the modules
 * whose shape may be styled but whose geometry may not be touched. Everything
 * marked `Data` is the message, and that is where a decorative shape is free.
 */
export const Role = {
  Data: 0,
  Finder: 1,
  Separator: 2,
  Timing: 3,
  Alignment: 4,
  Format: 5,
  Version: 6,
} as const;

export type ModuleRole = (typeof Role)[keyof typeof Role];

export type QrMode = "numeric" | "alphanumeric" | "byte";

export type QrSymbol = {
  version: number;
  ecLevel: EcLevel;
  /** Which of the eight mask patterns was applied. */
  mask: number;
  /** Modules across one side, excluding the quiet zone. */
  size: number;
  /** `size * size`, row-major. 1 = dark. */
  modules: Uint8Array;
  /** `size * size`, row-major. See `Role`. */
  roles: Uint8Array;
  /** The block structure and, with it, the damage budget. */
  plan: BlockPlan;
  mode: QrMode;
  /** The text this was built from, kept for the renderer's captions. */
  text: string;
};

/** Read one module. Out-of-range reads as light, which is what a quiet zone is. */
export function moduleAt(symbol: QrSymbol, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= symbol.size || y >= symbol.size) return false;
  return symbol.modules[y * symbol.size + x] === 1;
}

export function roleAt(symbol: QrSymbol, x: number, y: number): ModuleRole {
  if (x < 0 || y < 0 || x >= symbol.size || y >= symbol.size) return Role.Data;
  return symbol.roles[y * symbol.size + x] as ModuleRole;
}

/** The top-left corner of each of the three 7×7 finder eyes. */
export function eyeOrigins(size: number): { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
}

/* ============================================================
 * Choosing a mode
 *
 * One mode for the whole message, deliberately. A mixed-mode optimiser can
 * sometimes save a version on strings like "ABC123def", but every payload this
 * app produces is either a URL (lowercase, so byte mode throughout) or free
 * text, and an optimiser that occasionally picks a different equally-good
 * split is an optimiser whose output cannot be compared against anybody
 * else's. Correctness that can be checked beats a version saved on a string
 * nobody enters.
 * ========================================================== */

const ALNUM_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function isNumeric(text: string): boolean {
  return text.length > 0 && /^[0-9]*$/.test(text);
}

function isAlphanumeric(text: string): boolean {
  for (const ch of text) if (!ALNUM_CHARSET.includes(ch)) return false;
  return true;
}

export function modeFor(text: string): QrMode {
  if (isNumeric(text)) return "numeric";
  if (isAlphanumeric(text)) return "alphanumeric";
  return "byte";
}

/** The mode indicator's four bits. */
const MODE_BITS: Record<QrMode, number> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/**
 * How many bits the character count takes — it widens with the version,
 * because a bigger symbol can hold a longer message.
 */
function countBits(mode: QrMode, version: number): number {
  const tier = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === "numeric") return [10, 12, 14][tier];
  if (mode === "alphanumeric") return [9, 11, 13][tier];
  return [8, 16, 16][tier];
}

/* ============================================================
 * The bit stream
 * ========================================================== */

class BitBuffer {
  private bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  /** Pad to a whole number of codewords and emit them. */
  toCodewords(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) out[i >>> 3] |= 0x80 >>> (i & 7);
    }
    /*
     * The pad bytes are specified: 0xEC then 0x11, alternating, from the first
     * whole byte after the terminator. They are not arbitrary filler — a
     * decoder that reads past the terminator must find this exact pattern.
     */
    for (let i = Math.ceil(this.bits.length / 8), pad = 0xec; i < count; i++) {
      out[i] = pad;
      pad = pad === 0xec ? 0x11 : 0xec;
    }
    return out;
  }
}

/** The message's own bits, without the terminator or padding. */
function segmentBits(text: string, mode: QrMode, version: number): BitBuffer {
  const buf = new BitBuffer();
  const bytes = mode === "byte" ? new TextEncoder().encode(text) : null;
  const charCount = bytes ? bytes.length : [...text].length;

  buf.push(MODE_BITS[mode], 4);
  buf.push(charCount, countBits(mode, version));

  if (mode === "numeric") {
    // Three digits per 10 bits; a trailing one or two digits take 4 or 7.
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      buf.push(parseInt(chunk, 10), chunk.length * 3 + 1);
    }
  } else if (mode === "alphanumeric") {
    // Two characters per 11 bits, base 45; a trailing one takes 6.
    const chars = [...text];
    for (let i = 0; i < chars.length; i += 2) {
      const a = ALNUM_CHARSET.indexOf(chars[i]);
      if (i + 1 < chars.length) {
        buf.push(a * 45 + ALNUM_CHARSET.indexOf(chars[i + 1]), 11);
      } else {
        buf.push(a, 6);
      }
    }
  } else {
    for (const b of bytes!) buf.push(b, 8);
  }

  return buf;
}

/** How many bits a message needs at a given version. */
function bitsNeeded(text: string, mode: QrMode, version: number): number {
  return segmentBits(text, mode, version).length;
}

/* ============================================================
 * Choosing a version
 * ========================================================== */

export type VersionChoice =
  | { ok: true; version: number; mode: QrMode }
  | { ok: false; error: string };

/**
 * The smallest version that fits, within the bounds asked for.
 *
 * `minVersion` exists for a real reason rather than completeness: a short URL
 * fits in version 2, which is 25 modules across, and a 25-module code is
 * visually tiny next to a 10-module-wide logo. Asking for a floor gives the
 * design room without padding the message.
 */
export function chooseVersion(
  text: string,
  ecLevel: EcLevel,
  minVersion = MIN_VERSION,
  maxVersion = MAX_VERSION,
): VersionChoice {
  const mode = modeFor(text);
  const lo = Math.max(MIN_VERSION, Math.min(minVersion, MAX_VERSION));
  const hi = Math.max(lo, Math.min(maxVersion, MAX_VERSION));

  for (let version = lo; version <= hi; version++) {
    if (bitsNeeded(text, mode, version) <= dataCapacityBits(version, ecLevel)) {
      return { ok: true, version, mode };
    }
  }
  return {
    ok: false,
    error:
      `That is too long for a QR code at ${ecLevel} correction — ` +
      `${[...text].length} characters. Shorten it, or point the code at a ` +
      `short link instead.`,
  };
}

/**
 * The strongest correction level that still fits at a given version.
 *
 * Used when the design has a logo: spare capacity is worth more as redundancy
 * than as a smaller symbol, because redundancy is what the logo spends.
 */
export function strongestLevelAt(text: string, version: number): EcLevel | null {
  const mode = modeFor(text);
  for (const level of [...EC_LEVELS].reverse()) {
    if (bitsNeeded(text, mode, version) <= dataCapacityBits(version, level)) return level;
  }
  return null;
}

/* ============================================================
 * Codewords: split into blocks, add error correction, interleave
 * ========================================================== */

function addEcAndInterleave(data: Uint8Array, plan: BlockPlan): Uint8Array {
  const divisor = rsDivisor(plan.ecPerBlock);
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];

  let offset = 0;
  for (let i = 0; i < plan.numBlocks; i++) {
    const len = plan.shortBlockData + (i < plan.numShortBlocks ? 0 : 1);
    const slice = data.subarray(offset, offset + len);
    offset += len;
    blocks.push({ data: slice, ec: rsRemainder(slice, divisor) });
  }

  /*
   * Interleaving takes one codeword from each block in turn, which is what
   * makes a scratch across the symbol damage a little of every block rather
   * than all of one. Short blocks have no codeword to give on the last data
   * pass, so that column is simply skipped — the `i < b.data.length` guard.
   */
  const out = new Uint8Array(plan.totalCodewords);
  let k = 0;
  const longest = plan.shortBlockData + 1;
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.data.length) out[k++] = b.data[i];
  }
  for (let i = 0; i < plan.ecPerBlock; i++) {
    for (const b of blocks) out[k++] = b.ec[i];
  }
  return out;
}

/* ============================================================
 * Drawing the grid
 * ========================================================== */

class Grid {
  readonly size: number;
  readonly modules: Uint8Array;
  readonly roles: Uint8Array;
  /** 1 where a function pattern lives, so data placement can skip it. */
  private readonly reserved: Uint8Array;

  constructor(version: number) {
    this.size = sizeForVersion(version);
    const n = this.size * this.size;
    this.modules = new Uint8Array(n);
    this.roles = new Uint8Array(n);
    this.reserved = new Uint8Array(n);
  }

  private at(x: number, y: number): number {
    return y * this.size + x;
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  setFunction(x: number, y: number, dark: boolean, role: ModuleRole): void {
    if (!this.inside(x, y)) return;
    const i = this.at(x, y);
    this.modules[i] = dark ? 1 : 0;
    this.roles[i] = role;
    this.reserved[i] = 1;
  }

  isReserved(x: number, y: number): boolean {
    return this.reserved[this.at(x, y)] === 1;
  }

  setData(x: number, y: number, dark: boolean): void {
    this.modules[this.at(x, y)] = dark ? 1 : 0;
  }

  get(x: number, y: number): boolean {
    return this.inside(x, y) && this.modules[this.at(x, y)] === 1;
  }

  flip(x: number, y: number): void {
    const i = this.at(x, y);
    this.modules[i] ^= 1;
  }
}

/** A finder eye: a 7×7 ring with a 3×3 centre, plus its light separator. */
function drawFinder(g: Grid, ox: number, oy: number): void {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx;
      const y = oy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      const outside = dx === -1 || dy === -1 || dx === 7 || dy === 7;
      g.setFunction(x, y, ring !== 2 && !outside, outside ? Role.Separator : Role.Finder);
    }
  }
}

/** An alignment pattern: a 5×5 ring with a single dark centre. */
function drawAlignment(g: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      g.setFunction(cx + dx, cy + dy, ring !== 1, Role.Alignment);
    }
  }
}

/**
 * The 15 bits of format information: the correction level and the mask,
 * protected by a BCH(15,5) code and then masked with 0x5412 so that an
 * all-zero format cannot read as valid.
 */
export function formatBits(ecLevel: EcLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 bits of version information, BCH(18,6). Versions 7 and up only. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

/**
 * Both copies of the format information.
 *
 * Called twice: once with a placeholder, purely to RESERVE these modules
 * before the message is laid down, and again with the real bits once the mask
 * is known. Reserving first is not an optimisation — the data placement walk
 * skips reserved modules, so format cells that are not yet reserved would be
 * filled with message and then overwritten, shifting everything after them.
 */
function drawFormat(g: Grid, ecLevel: EcLevel, mask: number): void {
  const bits = formatBits(ecLevel, mask);
  const size = g.size;

  for (let i = 0; i <= 5; i++) g.setFunction(8, i, bit(bits, i), Role.Format);
  g.setFunction(8, 7, bit(bits, 6), Role.Format);
  g.setFunction(8, 8, bit(bits, 7), Role.Format);
  g.setFunction(7, 8, bit(bits, 8), Role.Format);
  for (let i = 9; i < 15; i++) g.setFunction(14 - i, 8, bit(bits, i), Role.Format);

  for (let i = 0; i < 8; i++) {
    g.setFunction(size - 1 - i, 8, bit(bits, i), Role.Format);
  }
  for (let i = 8; i < 15; i++) {
    g.setFunction(8, size - 15 + i, bit(bits, i), Role.Format);
  }
  // The one module that is dark in every symbol ever made.
  g.setFunction(8, size - 8, true, Role.Format);
}

function drawFunctionPatterns(g: Grid, version: number, ecLevel: EcLevel): void {
  const size = g.size;

  // Timing lines first, so the finders and alignment squares overwrite them
  // where they overlap — which is the order the standard describes.
  for (let i = 0; i < size; i++) {
    g.setFunction(6, i, i % 2 === 0, Role.Timing);
    g.setFunction(i, 6, i % 2 === 0, Role.Timing);
  }

  drawFinder(g, 0, 0);
  drawFinder(g, size - 7, 0);
  drawFinder(g, 0, size - 7);

  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      // The three corners are where the finders are; no alignment there.
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!corner) drawAlignment(g, positions[i], positions[j]);
    }
  }

  drawFormat(g, ecLevel, 0);

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.setFunction(a, b, dark, Role.Version);
      g.setFunction(b, a, dark, Role.Version);
    }
  }
}

/**
 * Lay the codewords down in the zigzag the standard specifies: two-module
 * columns from the right edge leftwards, alternating upward and downward,
 * skipping column 6 (the vertical timing line) and every reserved module.
 */
function drawCodewords(g: Grid, data: Uint8Array): void {
  const size = g.size;
  let i = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is timing all the way down, so the pair shifts one left past it.
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.isReserved(x, y) && i < data.length * 8) {
          g.setData(x, y, bit(data[i >>> 3], 7 - (i & 7)));
          i++;
        }
      }
    }
  }
}

/** The eight mask patterns. True means "flip this module". */
function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error(`mask ${mask} does not exist`);
  }
}

/** XOR a mask across the data modules. Function patterns are never masked. */
function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (!g.isReserved(x, y) && maskAt(mask, x, y)) g.flip(x, y);
    }
  }
}

/* ============================================================
 * Mask selection
 *
 * The standard scores all eight and keeps the lowest, where the score punishes
 * the four things that confuse a scanner: long same-colour runs, solid 2×2
 * blocks, anything resembling a finder pattern, and an overall light/dark
 * imbalance. The run-history form below is the one the standard describes, and
 * it is NOT the shortcut some libraries use for rule 3 — which is why
 * `encode.test.ts` compares against a forced mask rather than a chosen one.
 * ========================================================== */

const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_IMBALANCE = 10;

/** How many 1:1:3:1:1 finder-like runs the history ends in. */
function countFinderLike(history: number[]): number {
  const n = history[1];
  const core =
    n > 0 &&
    history[2] === n &&
    history[3] === n * 3 &&
    history[4] === n &&
    history[5] === n;
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}

function addRun(history: number[], runLength: number, size: number): void {
  // The first run of a line is treated as if the quiet zone preceded it, so a
  // finder pattern flush against the edge still scores.
  const length = history[0] === 0 ? runLength + size : runLength;
  history.pop();
  history.unshift(length);
}

function endLine(
  history: number[],
  runDark: boolean,
  runLength: number,
  size: number,
): number {
  let length = runLength;
  if (runDark) {
    addRun(history, length, size);
    length = 0;
  }
  addRun(history, length + size, size);
  return countFinderLike(history);
}

function penalty(g: Grid): number {
  const size = g.size;
  let score = 0;

  for (let pass = 0; pass < 2; pass++) {
    const rows = pass === 0;
    for (let a = 0; a < size; a++) {
      let runDark = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const dark = rows ? g.get(b, a) : g.get(a, b);
        if (dark === runDark) {
          runLength++;
          if (runLength === 5) score += PENALTY_RUN;
          else if (runLength > 5) score++;
        } else {
          addRun(history, runLength, size);
          if (!runDark) score += countFinderLike(history) * PENALTY_FINDER_LIKE;
          runDark = dark;
          runLength = 1;
        }
      }
      score += endLine(history, runDark, runLength, size) * PENALTY_FINDER_LIKE;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = g.get(x, y);
      if (c === g.get(x + 1, y) && c === g.get(x, y + 1) && c === g.get(x + 1, y + 1)) {
        score += PENALTY_BLOCK;
      }
    }
  }

  let dark = 0;
  for (let i = 0; i < g.modules.length; i++) dark += g.modules[i];
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + k * PENALTY_IMBALANCE;
}

/* ============================================================
 * The whole thing
 * ========================================================== */

export type EncodeOptions = {
  ecLevel?: EcLevel;
  minVersion?: number;
  maxVersion?: number;
  /** Force one of the eight masks. Omit to score all eight and keep the best. */
  mask?: number;
};

export type EncodeResult =
  | { ok: true; symbol: QrSymbol }
  | { ok: false; error: string };

/**
 * Text in, grid out.
 *
 * Returns a refusal rather than throwing, because the one failure that
 * actually happens is "too long", and the caller is a form that needs to say
 * so beside the field.
 */
export function encodeQr(text: string, options: EncodeOptions = {}): EncodeResult {
  const ecLevel = options.ecLevel ?? "M";
  if (text.length === 0) return { ok: false, error: "There is nothing to encode yet." };

  const choice = chooseVersion(text, ecLevel, options.minVersion, options.maxVersion);
  if (!choice.ok) return { ok: false, error: choice.error };

  const { version, mode } = choice;
  const plan = blockPlan(version, ecLevel);

  const buf = segmentBits(text, mode, version);
  const capacity = plan.dataCodewords * 8;
  // The terminator is four zero bits, or fewer if the message ends flush.
  buf.push(0, Math.min(4, capacity - buf.length));
  buf.push(0, (8 - (buf.length % 8)) % 8);

  const data = buf.toCodewords(plan.dataCodewords);
  const codewords = addEcAndInterleave(data, plan);

  const g = new Grid(version);
  drawFunctionPatterns(g, version, ecLevel);
  drawCodewords(g, codewords);

  let mask = options.mask;
  if (mask === undefined) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(g, m);
      drawFormat(g, ecLevel, m);
      const score = penalty(g);
      if (score < best) {
        best = score;
        mask = m;
      }
      applyMask(g, m); // XOR is its own inverse — undo and try the next.
    }
  }
  applyMask(g, mask!);
  drawFormat(g, ecLevel, mask!);

  return {
    ok: true,
    symbol: {
      version,
      ecLevel,
      mask: mask!,
      size: g.size,
      modules: g.modules,
      roles: g.roles,
      plan,
      mode,
      text,
    },
  };
}

/* ============================================================
 * Which codeword is this module part of?
 *
 * This is the function that makes the logo check a measurement rather than a
 * rule of thumb, and it is the reason this encoder is written out rather than
 * installed.
 *
 * Reed-Solomon repairs a whole number of CODEWORDS, not modules — a block with
 * 17 error-correction codewords survives 8 wrong ones, wherever in the block
 * they fall. So the real question about a logo is not "what fraction of the
 * picture does it cover" (the figure every QR generator quotes) but "how many
 * distinct codewords does it touch". Those differ by a factor of eight, which
 * is the difference between a 20% logo being obviously fine and obviously
 * fatal. The answer is exact and computable: walk the same zigzag the message
 * was laid down in and write each module's codeword number into a grid.
 *
 * -1 means the module carries no codeword: a function pattern, or one of the
 * up-to-seven remainder modules at the end that the standard leaves light.
 * ========================================================== */
export function codewordMap(symbol: QrSymbol): Int32Array {
  const size = symbol.size;
  const map = new Int32Array(size * size).fill(-1);
  const totalBits = symbol.plan.totalCodewords * 8;
  let i = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const at = y * size + x;
        if (symbol.roles[at] === Role.Data && i < totalBits) {
          map[at] = i >>> 3;
          i++;
        }
      }
    }
  }
  return map;
}

/**
 * How many distinct codewords are spoiled if `isDamaged` is true of a module.
 *
 * Exact for any shape of damage: a logo, a crease, a thumb. A caller passes
 * the geometry it is worried about and gets back a number to compare against
 * `symbol.plan.correctableCodewords`.
 */
export function spoiledCodewords(
  symbol: QrSymbol,
  isDamaged: (x: number, y: number) => boolean,
): number {
  const map = codewordMap(symbol);
  const spoiled = new Set<number>();
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      const cw = map[y * symbol.size + x];
      if (cw >= 0 && isDamaged(x, y)) spoiled.add(cw);
    }
  }
  return spoiled.size;
}

/**
 * Damage to a function pattern, split by what the pattern is for.
 *
 * NOT ALL FUNCTION PATTERNS ARE EQUAL, and treating them as equal was a real
 * bug. Error correction protects none of them, but they do not fail the same
 * way:
 *
 *   `structural` — the finder eyes, their separators, the timing lines, the
 *   format information and the version information. These are how a scanner
 *   FINDS the symbol and learns how to read it. Cover any of them and there is
 *   nothing to decode; this is fatal.
 *
 *   `alignment` — the little 5x5 rings. These correct for perspective
 *   distortion: a decoder uses them where it finds them and estimates the grid
 *   from the finder patterns where it does not. Covering one degrades a steep
 *   angle or a curved surface and is fine on a flat printed code photographed
 *   roughly square-on.
 *
 * That distinction matters because from version 7 to 13 there is an alignment
 * pattern AT THE CENTRE of the symbol — so "any logo in the middle of a
 * version 10 code is fatal" was the conclusion of counting them together, and
 * it is wrong. Every commercial QR generator puts logos on codes that size and
 * they scan.
 */
export type FunctionDamage = { structural: number; alignment: number };

export function damagedFunctionModules(
  symbol: QrSymbol,
  isDamaged: (x: number, y: number) => boolean,
): FunctionDamage {
  const out: FunctionDamage = { structural: 0, alignment: 0 };
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      const role = symbol.roles[y * symbol.size + x];
      if (role === Role.Data || !isDamaged(x, y)) continue;
      if (role === Role.Alignment) out.alignment++;
      else out.structural++;
    }
  }
  return out;
}

/**
 * Does this version have an alignment pattern at the middle of the symbol?
 *
 * True for versions 7 to 13, where one of the alignment coordinates lands on
 * the centre. The auto-fix prefers a version where it does not, so a logo
 * costs nothing at all rather than costing something survivable.
 */
export function hasCentralAlignment(version: number): boolean {
  const size = version * 4 + 17;
  const centre = (size - 1) / 2;
  return alignmentPositions(version).some((p) => Math.abs(p - centre) <= 2);
}
