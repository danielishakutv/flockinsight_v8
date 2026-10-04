/**
 * The QR specification's constant tables, and the arithmetic over them.
 *
 * Pure, no imports, safe in a browser — the whole QR module is, because a
 * church generating a code for its noticeboard should not be waiting on our
 * VPS to draw it. See the note at the top of `encode.ts` for why this is
 * written out rather than installed.
 *
 * WHY THE TABLES LOOK SMALLER THAN THE ONES IN THE STANDARD. ISO/IEC 18004
 * prints a 160-row table giving, per version and per error-correction level,
 * the block count and the data codewords in each of two block groups. Typing
 * 160 rows of five numbers by hand is 800 chances to transpose a digit, and a
 * transposed digit here does not throw — it produces a symbol that a phone
 * silently fails to read.
 *
 * All of it derives from two numbers per version and level, so only those two
 * are written down. Everything else is computed below, which means a typo can
 * only be in 160 numbers instead of 800 — and `encode.test.ts` checks every
 * one of the 160 against a mature third-party encoder across all 40 versions.
 */

export type EcLevel = "L" | "M" | "Q" | "H";

/** The four levels in increasing order of redundancy. */
export const EC_LEVELS: EcLevel[] = ["L", "M", "Q", "H"];

/**
 * Roughly what share of the symbol each level can lose and still be read.
 *
 * Approximate on purpose, and NOT what the logo check uses: the real budget is
 * counted in codewords for the specific version in hand (`correctableCodewords`
 * in `encode.ts`), because "30%" is a different number of modules at version 2
 * than at version 20. This map is here for wording a sentence to a human.
 */
export const EC_NOMINAL_RECOVERY: Record<EcLevel, number> = {
  L: 0.07,
  M: 0.15,
  Q: 0.25,
  H: 0.3,
};

export const EC_LABEL: Record<EcLevel, string> = {
  L: "Low",
  M: "Medium",
  Q: "Quartile",
  H: "High",
};

/** The 5 bits the format information carries for each level. */
export const EC_FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** A symbol is 21 modules across at version 1 and grows by 4 each version. */
export function sizeForVersion(version: number): number {
  return version * 4 + 17;
}

/* ============================================================
 * The two tables that are genuinely data
 * ========================================================== */

/**
 * Error-correction codewords in each block, by level and version.
 * Index 0 is unused so the version number indexes directly.
 */
const ECC_CODEWORDS_PER_BLOCK: Record<EcLevel, readonly number[]> = {
  L: [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
    28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30,
  ],
  M: [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28,
  ],
  Q: [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
    30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30,
  ],
  H: [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
    28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30,
  ],
};

/** How many blocks the codewords are split into, by level and version. */
const NUM_BLOCKS: Record<EcLevel, readonly number[]> = {
  L: [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12,
    12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18,
    20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23,
    25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34,
    30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/* ============================================================
 * Everything else, computed
 * ========================================================== */

/**
 * How many modules a version has available for data and error correction,
 * i.e. the whole grid minus every function pattern.
 *
 * Derived rather than tabulated: the area is `(4v+17)²`, from which the three
 * finders with their separators and format areas take a fixed 192 + 2×(4v+17)
 * worth of rows and columns, the alignment patterns take 25 each less their
 * overlaps with the timing lines, and from version 7 the version information
 * takes a further 36. Written in the folded form Nayuki uses because it is the
 * form that has been checked against the standard's own table for all 40
 * versions.
 */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export type BlockPlan = {
  version: number;
  ecLevel: EcLevel;
  /** Total codewords in the symbol (data + error correction). */
  totalCodewords: number;
  /** Codewords that carry the message. */
  dataCodewords: number;
  /** Codewords of error correction. */
  ecCodewords: number;
  /** How many blocks the message is split into. */
  numBlocks: number;
  /** Error-correction codewords per block (the same for every block). */
  ecPerBlock: number;
  /** Data codewords in a "short" block. */
  shortBlockData: number;
  /** How many blocks are short; the rest carry one extra data codeword. */
  numShortBlocks: number;
  /**
   * Codewords that can be corrected if they arrive wrong.
   *
   * A block with `n` error-correction codewords survives `floor(n/2)` wrong
   * codewords — Reed-Solomon needs two codewords of redundancy to FIND and
   * FIX one unknown error. This is the honest damage budget, and it is what
   * decides whether a logo in the middle is safe.
   */
  correctableCodewords: number;
};

/** The block structure for a version and level, with its damage budget. */
export function blockPlan(version: number, ecLevel: EcLevel): BlockPlan {
  const totalCodewords = Math.floor(rawDataModules(version) / 8);
  const numBlocks = NUM_BLOCKS[ecLevel][version];
  const ecPerBlock = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const ecCodewords = ecPerBlock * numBlocks;
  const dataCodewords = totalCodewords - ecCodewords;

  /*
   * Blocks come in at most two sizes, differing by exactly one codeword, and
   * the SHORT ones come first. `rawCodewords % numBlocks` blocks are long, so
   * the remainder subtracted from the count gives how many are short.
   */
  const shortBlockLen = Math.floor(totalCodewords / numBlocks);
  const numShortBlocks = numBlocks - (totalCodewords % numBlocks);

  return {
    version,
    ecLevel,
    totalCodewords,
    dataCodewords,
    ecCodewords,
    numBlocks,
    ecPerBlock,
    shortBlockData: shortBlockLen - ecPerBlock,
    numShortBlocks,
    correctableCodewords: numBlocks * Math.floor(ecPerBlock / 2),
  };
}

/** How many message bits a version and level can hold. */
export function dataCapacityBits(version: number, ecLevel: EcLevel): number {
  return blockPlan(version, ecLevel).dataCodewords * 8;
}

/**
 * The centre coordinates of the alignment patterns.
 *
 * The first is always 6 and the last always `size - 7`; the ones between are
 * spaced evenly, rounded UP to an even number, and the spec specifies them by
 * working backwards from the last — which is why this fills the array from the
 * end. Version 1 has none at all.
 */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = sizeForVersion(version);
  /*
   * Version 32 is the one the formula does not fit. Its spacing is 26 where
   * the even rounding gives 28, so the standard's own table has to be taken
   * over the arithmetic. Left as an explicit exception rather than a cleverer
   * expression, because the exception is the fact.
   */
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const out: number[] = [6];
  for (let pos = size - 7; out.length < numAlign; pos -= step) out.splice(1, 0, pos);
  return out;
}

/* ============================================================
 * GF(256), for Reed-Solomon
 *
 * The field is GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D), which is the
 * polynomial the QR standard names. Multiplication is done by shift-and-reduce
 * rather than through log tables: it is called a few thousand times to build a
 * symbol, which is nothing, and the straight-line version has no table to get
 * wrong.
 * ========================================================== */

export function gfMultiply(a: number, b: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

/**
 * The divisor polynomial for `degree` error-correction codewords: the product
 * of (x - 2^i) for i in 0..degree-1, with the leading 1 left implicit.
 */
export function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The remainder of `data` divided by `divisor` — the error-correction block. */
export function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}
