import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  Role,
  chooseVersion,
  encodeQr,
  eyeOrigins,
  formatBits,
  modeFor,
  moduleAt,
  strongestLevelAt,
  versionBits,
} from "@/lib/qr/encode";
import {
  EC_LEVELS,
  alignmentPositions,
  blockPlan,
  gfMultiply,
  rawDataModules,
  sizeForVersion,
  type EcLevel,
} from "@/lib/qr/tables";

/**
 * The QR encoder, checked against someone else's.
 *
 * `encode.ts` exists because every QR library hands back a picture and this
 * one needs the grid. That is a good reason to write an encoder and a bad
 * reason to trust it: a transposed digit in the block tables does not throw,
 * it produces a symbol that a phone quietly fails to read, which is a bug
 * nobody finds until a church has printed four hundred flyers.
 *
 * So `qrcode` (a mature, widely used encoder) is a DEV dependency used here
 * and nowhere else, and these tests compare the two module for module across
 * every version, every correction level and all three modes. Nothing of it
 * ships to a browser.
 *
 * WHY THE MASK IS FORCED in the comparison. The standard scores all eight
 * masks and keeps the lowest; its rule 3 (penalise anything finder-like) is
 * specified as a run-length history, and some libraries implement a cheaper
 * approximation of it. Where the two disagree they pick different masks, and
 * two different masks give two different — both valid — symbols. Forcing the
 * mask takes that one disagreement out, leaving every other part of the
 * pipeline (tables, Reed-Solomon, interleaving, placement, format and version
 * information, the mask patterns themselves) under exact comparison.
 *
 * WHY THE INPUTS ARE SORTED BY MODE. A mixed string like "ABC123def" can be
 * split into segments more than one way, each optimal; `qrcode` optimises,
 * this encoder uses one mode throughout (see the note in encode.ts). So the
 * comparison uses strings whose segmentation is not a choice: all digits, all
 * alphanumeric, or containing a character that forces byte mode.
 */

/** `qrcode`'s matrix, as a flat array of 0/1, for one forced configuration. */
function reference(
  text: string,
  ecLevel: EcLevel,
  version: number,
  mask: number,
): { size: number; modules: Uint8Array } {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: ecLevel,
    version,
    // `qrcode` types this as a union of the eight literals; the comparison
    // sweeps over them numerically, which is the whole point.
    maskPattern: mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
  });
  const size = qr.modules.size;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = qr.modules.data[i] ? 1 : 0;
  return { size, modules: out };
}

function render(size: number, modules: Uint8Array): string {
  const lines: string[] = [];
  for (let y = 0; y < size; y++) {
    let line = "";
    for (let x = 0; x < size; x++) line += modules[y * size + x] ? "#" : ".";
    lines.push(line);
  }
  return lines.join("\n");
}

/** A deterministic pseudo-random generator, so a failure is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type TextKind = "numeric" | "alphanumeric" | "byte" | "utf8";

function randomText(kind: TextKind, length: number, next: () => number): string {
  /*
   * CHARSETS CHOSEN SO THAT SEGMENTATION IS NOT A CHOICE.
   *
   * This is the trap that produced four confusing failures the first time
   * these tests ran, and the encoder was innocent every time. `qrcode`
   * optimises a payload into MULTIPLE segments; this encoder uses one mode
   * throughout (see encode.ts). Both are valid, and they agree only when no
   * split could possibly be denser than the whole.
   *
   * So: the alphanumeric set holds no digits (or a run of digits would become
   * a numeric segment), and the byte sets hold no digits, no uppercase and
   * none of the alphanumeric mode's symbols `$%*+-./:` or space (or a run of
   * those would become an alphanumeric segment).
   */
  const sets = {
    numeric: "0123456789",
    alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./:",
    byte: "abcdefghijklmnopqrstuvwxyz_?=&~!@#^",
    // Byte mode again, but where one character is several bytes: a Yoruba
    // church name and a Mandarin greeting both arrive this way, and a
    // character count mistaken for a byte count is the classic bug.
    utf8: "ṣẹ́àéîöüñ中音abcxyz",
  } as const;
  const set = sets[kind];
  let out = "";
  for (let i = 0; i < length; i++) out += set[Math.floor(next() * set.length)];
  return out;
}

/* ============================================================
 * The tables
 * ========================================================== */

describe("the specification's tables", () => {
  it("agrees with the reference encoder on every version and level", () => {
    // `qrcode` exposes the same structure under different names; if our
    // derived block plan matched the standard only for small versions, this is
    // where it would show, because the two-group split changes shape with
    // every version.
    for (let version = 1; version <= 40; version++) {
      for (const level of EC_LEVELS) {
        const plan = blockPlan(version, level);
        const qr = QRCode.create("A", { version, errorCorrectionLevel: level });
        expect(
          { v: version, l: level, size: sizeForVersion(version) },
          `version ${version} ${level}`,
        ).toEqual({ v: version, l: level, size: qr.modules.size });
        // Total codewords is the one number both encoders must agree on for
        // the interleave to line up at all.
        expect(plan.totalCodewords, `version ${version} ${level} codewords`).toBe(
          Math.floor(rawDataModules(version) / 8),
        );
        expect(plan.dataCodewords + plan.ecCodewords).toBe(plan.totalCodewords);
        expect(plan.dataCodewords).toBeGreaterThan(0);
        // Blocks differ by at most one codeword, and the short ones come first.
        expect(
          plan.numShortBlocks,
          `version ${version} ${level} short blocks`,
        ).toBeLessThanOrEqual(plan.numBlocks);
        const accounted =
          plan.numShortBlocks * plan.shortBlockData +
          (plan.numBlocks - plan.numShortBlocks) * (plan.shortBlockData + 1);
        expect(accounted, `version ${version} ${level} block sum`).toBe(
          plan.dataCodewords,
        );
      }
    }
  });

  it("puts the alignment patterns where the standard does", () => {
    // Spot values from ISO/IEC 18004 Annex E. Version 32 is included because
    // it is the one the spacing formula does not fit.
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPositions(21)).toEqual([6, 28, 50, 72, 94]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it("multiplies in GF(256) with the polynomial the standard names", () => {
    expect(gfMultiply(0, 123)).toBe(0);
    expect(gfMultiply(1, 123)).toBe(123);
    // 0x80 doubled overflows eight bits and reduces by 0x11D — which is the
    // one place the choice of polynomial is visible. AES uses 0x11B and would
    // give 0x1B here; Reed-Solomon over the wrong field corrects nothing.
    expect(gfMultiply(0x80, 0x02)).toBe(0x1d);

    for (let a = 1; a < 256; a += 37) {
      for (let b = 1; b < 256; b += 53) {
        expect(gfMultiply(a, b), `${a}x${b}`).toBe(gfMultiply(b, a));
        // Distributive over XOR, which is addition in this field.
        expect(gfMultiply(a, b ^ 7)).toBe(gfMultiply(a, b) ^ gfMultiply(a, 7));
      }
    }
  });

  it("has 2 as a generator, so the field really is 256 elements", () => {
    // If 0x11D were not primitive, the powers of 2 would cycle early and
    // Reed-Solomon's divisor polynomial would have repeated roots. Every
    // non-zero element must appear exactly once in 255 doublings.
    const seen = new Set<number>();
    let x = 1;
    for (let i = 0; i < 255; i++) {
      seen.add(x);
      x = gfMultiply(x, 2);
    }
    expect(seen.size).toBe(255);
    expect(seen.has(0)).toBe(false);
    expect(x).toBe(1); // and it closes the cycle
  });
});

describe("format and version information", () => {
  it("matches the standard's published bit strings", () => {
    // Table C.1: (M, mask 0) is 0b101010000010010.
    expect(formatBits("M", 0)).toBe(0b101010000010010);
    expect(formatBits("L", 0)).toBe(0b111011111000100);
    expect(formatBits("Q", 7)).toBe(0b010101111101101);
    expect(formatBits("H", 7)).toBe(0b000100000111011);
  });

  it("matches the standard's published version bit strings", () => {
    // Table D.1.
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(21)).toBe(0b010101011010000011);
    expect(versionBits(40)).toBe(0b101000110001101001);
  });
});

/* ============================================================
 * The whole pipeline, against the reference encoder
 * ========================================================== */

describe("the encoder, module for module against qrcode", () => {
  it("matches on a plain URL at every correction level and every mask", () => {
    const text = "https://flockinsight.com/l/welcome";
    for (const level of EC_LEVELS) {
      const choice = chooseVersion(text, level);
      expect(choice.ok).toBe(true);
      if (!choice.ok) return;
      for (let mask = 0; mask < 8; mask++) {
        const got = encodeQr(text, { ecLevel: level, mask, minVersion: choice.version });
        expect(got.ok, `${level} mask ${mask}`).toBe(true);
        if (!got.ok) return;
        const want = reference(text, level, got.symbol.version, mask);
        expect(got.symbol.size).toBe(want.size);
        expect(
          render(got.symbol.size, got.symbol.modules),
          `level ${level}, mask ${mask}`,
        ).toBe(render(want.size, want.modules));
      }
    }
  });

  it("matches at every version from 1 to 40", () => {
    const next = rng(20261004);
    for (let version = 1; version <= 40; version++) {
      for (const level of EC_LEVELS) {
        const capacity = blockPlan(version, level).dataCodewords;
        // A message long enough to need most of this version but not the next,
        // so the padding path and the full-capacity path both get exercised.
        const length = Math.max(1, capacity - 4);
        const text = randomText("byte", length, next);
        const got = encodeQr(text, {
          ecLevel: level,
          minVersion: version,
          maxVersion: version,
          mask: 3,
        });
        expect(got.ok, `version ${version} ${level} (${length} chars)`).toBe(true);
        if (!got.ok) continue;
        expect(got.symbol.version).toBe(version);
        const want = reference(text, level, version, 3);
        expect(
          render(got.symbol.size, got.symbol.modules),
          `version ${version}, level ${level}`,
        ).toBe(render(want.size, want.modules));
      }
    }
  });

  it("matches in numeric, alphanumeric and byte mode", () => {
    const next = rng(7);
    for (const kind of ["numeric", "alphanumeric", "byte", "utf8"] as const) {
      for (const length of [1, 2, 3, 4, 9, 17, 40, 120, 300]) {
        const text = randomText(kind, length, next);
        const mode = kind === "utf8" ? "byte" : kind;
        expect(modeFor(text), `${kind} "${text.slice(0, 12)}…"`).toBe(mode);
        const got = encodeQr(text, { ecLevel: "Q", mask: 1 });
        expect(got.ok, `${kind} ${length}`).toBe(true);
        if (!got.ok) continue;
        const want = reference(text, "Q", got.symbol.version, 1);
        expect(
          render(got.symbol.size, got.symbol.modules),
          `${kind}, ${length} characters`,
        ).toBe(render(want.size, want.modules));
      }
    }
  });

  it("matches on sixty random payloads of random shapes", () => {
    const next = rng(99);
    for (let i = 0; i < 60; i++) {
      const kind = (["numeric", "alphanumeric", "byte", "utf8"] as const)[
        Math.floor(next() * 4)
      ];
      const level = EC_LEVELS[Math.floor(next() * 4)];
      const mask = Math.floor(next() * 8);
      const length = 1 + Math.floor(next() * 400);
      const text = randomText(kind, length, next);
      const got = encodeQr(text, { ecLevel: level, mask });
      expect(got.ok, `#${i} ${kind} ${length} ${level}`).toBe(true);
      if (!got.ok) continue;
      const want = reference(text, level, got.symbol.version, mask);
      expect(
        render(got.symbol.size, got.symbol.modules),
        `#${i}: ${kind}, ${length} chars, level ${level}, mask ${mask}`,
      ).toBe(render(want.size, want.modules));
    }
  });
});

/* ============================================================
 * The things no other encoder would tell us
 * ========================================================== */

describe("module roles", () => {
  const symbol = (() => {
    const r = encodeQr("https://flockinsight.com/l/abcdef", { ecLevel: "H" });
    if (!r.ok) throw new Error(r.error);
    return r.symbol;
  })();

  it("marks all three finder eyes, and nothing else, as Finder", () => {
    let finders = 0;
    for (let y = 0; y < symbol.size; y++) {
      for (let x = 0; x < symbol.size; x++) {
        if (symbol.roles[y * symbol.size + x] === Role.Finder) finders++;
      }
    }
    // Three eyes of 7×7. The separators around them are their own role.
    expect(finders).toBe(3 * 49);
  });

  it("puts a finder eye at each of the three corners", () => {
    for (const { x, y } of eyeOrigins(symbol.size)) {
      // The ring: dark at the rim, light one in, dark in the 3×3 middle.
      expect(moduleAt(symbol, x, y)).toBe(true);
      expect(moduleAt(symbol, x + 1, y + 1)).toBe(false);
      expect(moduleAt(symbol, x + 3, y + 3)).toBe(true);
    }
  });

  it("keeps the one module that is dark in every QR code ever made", () => {
    expect(moduleAt(symbol, 8, symbol.size - 8)).toBe(true);
  });

  it("never marks a data module as a function pattern", () => {
    // The count has to come out at the standard's own figure, or the data
    // placement walk skipped the wrong cells.
    let data = 0;
    for (let i = 0; i < symbol.roles.length; i++) {
      if (symbol.roles[i] === Role.Data) data++;
    }
    expect(data).toBe(rawDataModules(symbol.version));
  });
});

describe("the damage budget", () => {
  it("counts what Reed-Solomon can actually repair, not a percentage", () => {
    // Version 1 H: 1 block, 17 EC codewords, so 8 codewords correctable.
    const v1h = blockPlan(1, "H");
    expect(v1h.numBlocks).toBe(1);
    expect(v1h.ecPerBlock).toBe(17);
    expect(v1h.correctableCodewords).toBe(8);

    // High correction always leaves more headroom than Low, at every version.
    for (let v = 1; v <= 40; v++) {
      expect(
        blockPlan(v, "H").correctableCodewords / blockPlan(v, "H").totalCodewords,
        `version ${v}`,
      ).toBeGreaterThan(
        blockPlan(v, "L").correctableCodewords / blockPlan(v, "L").totalCodewords,
      );
    }
  });
});

describe("choosing a version and a level", () => {
  it("picks the smallest version that fits", () => {
    expect(chooseVersion("1234567", "L")).toMatchObject({ version: 1 });
    // 26 data codewords at version 1 L; this cannot be one of them.
    const long = "x".repeat(200);
    const choice = chooseVersion(long, "L");
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.version).toBeGreaterThan(5);
  });

  it("honours a floor, so a design can ask for a denser grid", () => {
    const choice = chooseVersion("hello", "M", 6);
    expect(choice).toMatchObject({ ok: true, version: 6 });
  });

  it("refuses, with a sentence, rather than throwing", () => {
    const res = encodeQr("x".repeat(5000), { ecLevel: "H" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("too long");
      // It must say what to do about it, not merely that it failed.
      expect(res.error).toContain("short link");
    }
  });

  it("refuses an empty payload", () => {
    expect(encodeQr("")).toMatchObject({ ok: false });
  });

  it("spends spare room on redundancy, which is what a logo eats", () => {
    // A short URL fits version 3 at every level, so High is available.
    const text = "https://flockinsight.com/l/abc";
    const choice = chooseVersion(text, "L");
    expect(choice.ok).toBe(true);
    if (!choice.ok) return;
    const stronger = strongestLevelAt(text, choice.version + 2);
    expect(stronger).toBe("H");
  });
});

describe("mask selection", () => {
  it("is deterministic — the same text always gives the same symbol", () => {
    const a = encodeQr("https://flockinsight.com/l/sunday", { ecLevel: "Q" });
    const b = encodeQr("https://flockinsight.com/l/sunday", { ecLevel: "Q" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.symbol.mask).toBe(b.symbol.mask);
    expect(Array.from(a.symbol.modules)).toEqual(Array.from(b.symbol.modules));
  });

  it("records the mask it chose in the format information", () => {
    const res = encodeQr("https://flockinsight.com/l/sunday", { ecLevel: "Q" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { symbol } = res;
    // The format bits are written twice; read the first copy back out of the
    // grid and check it is the format for the level and mask claimed.
    const want = formatBits(symbol.ecLevel, symbol.mask);
    let got = 0;
    for (let i = 0; i <= 5; i++) {
      if (moduleAt(symbol, 8, i)) got |= 1 << i;
    }
    if (moduleAt(symbol, 8, 7)) got |= 1 << 6;
    if (moduleAt(symbol, 8, 8)) got |= 1 << 7;
    if (moduleAt(symbol, 7, 8)) got |= 1 << 8;
    for (let i = 9; i < 15; i++) {
      if (moduleAt(symbol, 14 - i, 8)) got |= 1 << i;
    }
    expect(got).toBe(want);
  });
});
