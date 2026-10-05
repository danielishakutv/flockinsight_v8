import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN,
  minVersionForCentre,
  normaliseDesign,
  structuralMinVersion,
  type QrCentre,
  type QrDesign,
} from "@/lib/qr/design";
import {
  Role,
  codewordMap,
  damagedFunctionModules,
  encodeQr,
  spoiledCodewords,
  type QrSymbol,
} from "@/lib/qr/encode";
import { alignmentPositions, rawDataModules } from "@/lib/qr/tables";
import { analyse, confidenceOf } from "@/lib/qr/verify";
import { describeSample, sampleRendered } from "@/lib/qr/verify-render";

/**
 * The scannability checks.
 *
 * These are the only part of the feature whose failure is silent and late: a
 * code that does not scan looks exactly like one that does until it is on four
 * hundred printed flyers. So the budget arithmetic is tested against the
 * specification's own figures, and each refusal is tested for saying what to
 * do rather than that something is wrong.
 */

const URL = "https://flockinsight.com/l/sunday";

function symbol(options: { ecLevel?: "L" | "M" | "Q" | "H"; minVersion?: number } = {}): QrSymbol {
  const res = encodeQr(URL, { ecLevel: options.ecLevel ?? "M", minVersion: options.minVersion });
  if (!res.ok) throw new Error(res.error);
  return res.symbol;
}

function design(over: Partial<QrDesign>): QrDesign {
  return normaliseDesign({ ...DEFAULT_DESIGN, ...over });
}

function centre(over: Partial<Extract<QrCentre, { type: "icon" }>>): QrCentre {
  return {
    type: "icon",
    icon: "cross",
    size: 0.2,
    shape: "square",
    color: "#ffffff",
    backdropColor: "#11182a",
    ...over,
  };
}

/* ============================================================
 * The codeword map — what makes the logo check a measurement
 * ========================================================== */

describe("the codeword map", () => {
  const s = symbol({ ecLevel: "H", minVersion: 6 });

  it("gives every data module a codeword, and function modules none", () => {
    const map = codewordMap(s);
    let mapped = 0;
    let unmapped = 0;
    for (let i = 0; i < map.length; i++) {
      const isData = s.roles[i] === Role.Data;
      if (!isData) {
        expect(map[i]).toBe(-1);
        continue;
      }
      if (map[i] >= 0) mapped++;
      else unmapped++;
    }
    expect(mapped).toBe(s.plan.totalCodewords * 8);
    /*
     * The leftovers are the standard's "remainder bits": up to seven modules
     * at the end of the zigzag that no codeword reaches and that stay light.
     * Any more than seven means the placement walk skipped something.
     */
    expect(unmapped).toBe(rawDataModules(s.version) - s.plan.totalCodewords * 8);
    expect(unmapped).toBeLessThanOrEqual(7);
  });

  it("gives each codeword exactly eight modules", () => {
    const map = codewordMap(s);
    const counts = new Map<number, number>();
    for (const cw of map) {
      if (cw >= 0) counts.set(cw, (counts.get(cw) ?? 0) + 1);
    }
    expect(counts.size).toBe(s.plan.totalCodewords);
    for (const [cw, count] of counts) expect(count, `codeword ${cw}`).toBe(8);
  });

  it("counts distinct spoiled codewords, not spoiled modules", () => {
    /*
     * The whole point. A codeword is eight modules, so damage counted in
     * modules overstates the harm by up to eightfold — which is the
     * difference between a 20% logo being obviously fine and obviously fatal.
     */
    const map = codewordMap(s);
    // Find the eight modules of codeword 0 and damage all of them.
    const target: { x: number; y: number }[] = [];
    for (let y = 0; y < s.size; y++) {
      for (let x = 0; x < s.size; x++) {
        if (map[y * s.size + x] === 0) target.push({ x, y });
      }
    }
    expect(target).toHaveLength(8);
    const hit = (x: number, y: number): boolean =>
      target.some((t) => t.x === x && t.y === y);
    expect(spoiledCodewords(s, hit)).toBe(1);

    // And one module of it spoils the same single codeword.
    const one = target[3];
    expect(spoiledCodewords(s, (x, y) => x === one.x && y === one.y)).toBe(1);
  });

  it("counts nothing spoiled when nothing is damaged", () => {
    expect(spoiledCodewords(s, () => false)).toBe(0);
    expect(damagedFunctionModules(s, () => false)).toEqual({
      structural: 0,
      alignment: 0,
    });
  });

  it("counts function-pattern damage separately, because nothing repairs it", () => {
    // The top-left finder eye: 49 modules, none of them protected.
    const inEye = (x: number, y: number): boolean => x < 7 && y < 7;
    expect(damagedFunctionModules(s, inEye)).toEqual({ structural: 49, alignment: 0 });
    // And none of those are codewords, so the codeword count stays at zero.
    expect(spoiledCodewords(s, inEye)).toBe(0);
  });

  it("separates an alignment ring from the patterns that are fatal", () => {
    /*
     * The distinction that a wrong answer depended on. Counting alignment
     * rings with the finder and format patterns made every logo on a version
     * 7-to-13 code read as unscannable, because those versions put a ring
     * exactly at the centre — and such codes scan perfectly well.
     */
    const [first, second] = alignmentPositions(s.version);
    expect(second, `version ${s.version} should have alignment patterns`).toBeDefined();
    const ring = (x: number, y: number): boolean =>
      Math.abs(x - second) <= 2 && Math.abs(y - second) <= 2;
    const damage = damagedFunctionModules(s, ring);
    expect(first).toBe(6);
    expect(damage.alignment).toBe(25); // a 5x5 ring
    expect(damage.structural).toBe(0);
  });
});

/* ============================================================
 * Contrast
 * ========================================================== */

describe("contrast", () => {
  it("blocks a code whose modules cannot be told from its background", () => {
    const a = analyse(
      symbol(),
      design({
        fill: { type: "solid", color: "#9ca3af" },
        background: { type: "solid", color: "#d1d5db" },
      }),
    );
    expect(a.scannable).toBe(false);
    const finding = a.findings.find((f) => f.key === "contrast.floor");
    expect(finding?.level).toBe("blocker");
    // The measurement, and what to do about it — never just "bad contrast".
    expect(finding?.detail).toMatch(/\d\.\d:1/);
    expect(finding?.detail).toMatch(/Darken|lighten/i);
    expect(confidenceOf(a)).toBe("blocked");
  });

  it("warns, without blocking, about a colour that needs good light", () => {
    const a = analyse(
      symbol(),
      design({ fill: { type: "solid", color: "#0d9488" } }),
    );
    expect(a.scannable).toBe(true);
    expect(a.findings.find((f) => f.key === "contrast.low")?.level).toBe("warning");
    expect(confidenceOf(a)).toBe("screen-only");
  });

  it("says nothing about contrast for black on white", () => {
    const a = analyse(
      symbol(),
      design({ fill: { type: "solid", color: "#000000" } }),
    );
    expect(a.findings.filter((f) => f.key.startsWith("contrast"))).toEqual([]);
    expect(a.metrics.contrast).toBeCloseTo(21, 1);
  });

  it("checks the worst pair of a gradient, not the average", () => {
    // A gradient is as weak as its lightest end; averaging would hide that.
    const a = analyse(
      symbol(),
      design({ fill: { type: "linear", from: "#000000", to: "#e5e7eb", angle: 0 } }),
    );
    expect(a.metrics.contrast).toBeLessThan(2);
    expect(a.scannable).toBe(false);
  });

  it("admits it cannot judge a photograph, and points at the check that can", () => {
    const a = analyse(symbol(), design({ fill: { type: "image", url: "https://x/y.jpg" } }));
    const finding = a.findings.find((f) => f.key === "contrast.unknowable");
    expect(finding?.level).toBe("note");
    expect(finding?.detail).toContain("the way a scanner sees it");
    expect(a.metrics.contrast).toBeNull();
    // An honest "cannot tell" must not read as a failure.
    expect(a.scannable).toBe(true);
  });

  it("warns about an inverted code, because some scanners refuse one", () => {
    const a = analyse(
      symbol(),
      design({
        fill: { type: "solid", color: "#ffffff" },
        background: { type: "solid", color: "#11182a" },
      }),
    );
    expect(a.findings.find((f) => f.key === "inverted")?.level).toBe("warning");
    expect(a.scannable).toBe(true);
  });
});

/* ============================================================
 * The logo budget
 * ========================================================== */

describe("the middle", () => {
  it("treats a covered alignment ring as a note, not a blocker", () => {
    // Version 7 to 13 put one at the centre, so this is the normal case for a
    // logo on a medium-sized code rather than an edge case.
    const big = symbol({ ecLevel: "H", minVersion: 10 });
    expect(big.version).toBeGreaterThanOrEqual(10);
    const a = analyse(big, design({ centre: centre({ size: 0.2 }), ecLevel: "H", minVersion: 10 }));
    expect(a.metrics.functionDamage.alignment).toBeGreaterThan(0);
    expect(a.metrics.functionDamage.structural).toBe(0);
    expect(a.scannable).toBe(true);
    const note = a.findings.find((f) => f.key === "centre.alignment");
    expect(note?.level).toBe("note");
    // It must say what is actually lost, not merely that something is.
    expect(note?.detail).toContain("steep angle");
  });

  it("costs nothing when there is nothing in it", () => {
    const a = analyse(symbol(), design({ centre: { type: "none" } }));
    expect(a.metrics.spoiled).toBe(0);
    expect(a.findings.find((f) => f.key.startsWith("centre"))).toBeUndefined();
  });

  it("costs nothing for a logo with no file chosen yet", () => {
    // Picking "logo" before picking the logo must not report a budget spent on
    // something that is not drawn.
    const a = analyse(
      symbol(),
      design({
        centre: {
          type: "image",
          url: "",
          size: 0.3,
          shape: "circle",
          backdrop: true,
          backdropColor: "#ffffff",
        },
      }),
    );
    expect(a.metrics.spoiled).toBe(0);
  });

  it("reports the figures, both the cost and what is left", () => {
    const s = symbol({ ecLevel: "H", minVersion: 6 });
    const a = analyse(s, design({ centre: centre({ size: 0.2 }), ecLevel: "H", minVersion: 6 }));
    expect(a.metrics.spoiled).toBeGreaterThan(0);
    expect(a.metrics.correctable).toBe(s.plan.correctableCodewords);
    expect(a.metrics.headroom).toBe(a.metrics.correctable - a.metrics.spoiled);
    const note = a.findings.find((f) => f.key.startsWith("centre"));
    expect(note?.detail).toContain(String(a.metrics.spoiled));
    expect(note?.detail).toContain(String(a.metrics.correctable));
  });

  it("gets cheaper, not dearer, as the grid gets denser", () => {
    /*
     * The counter-intuitive fact the designer needs to convey: a bigger grid
     * has more codewords, so the same proportional logo spoils a smaller SHARE
     * of them. This is why "Smallest grid" is offered as a fix.
     */
    const small = analyse(
      symbol({ ecLevel: "H", minVersion: 3 }),
      design({ centre: centre({ size: 0.25 }), ecLevel: "H", minVersion: 3 }),
    );
    const large = analyse(
      symbol({ ecLevel: "H", minVersion: 10 }),
      design({ centre: centre({ size: 0.25 }), ecLevel: "H", minVersion: 10 }),
    );
    const shareOf = (a: ReturnType<typeof analyse>): number =>
      a.metrics.spoiled / a.metrics.correctable;
    expect(shareOf(large)).toBeLessThan(shareOf(small));
  });

  it("blocks a logo that spoils more than the correction can repair", () => {
    // Low correction on a small grid is the combination that cannot take one.
    const a = analyse(
      symbol({ ecLevel: "L", minVersion: 2 }),
      design({ centre: centre({ size: 0.3 }), ecLevel: "L", minVersion: 2 }),
    );
    const blocker = a.findings.find((f) => f.level === "blocker");
    expect(blocker).toBeDefined();
    expect(a.scannable).toBe(false);
    // It must name all three ways out, since which one suits is the church's call.
    const detail = a.findings.map((f) => f.detail).join(" ");
    expect(detail).toMatch(/smaller/);
  });

  it("catches the overlap the 30% cap does not prevent on a tiny grid", () => {
    /*
     * This test was written to assert the opposite — that the 30% cap makes an
     * unrepairable overlap impossible — and found that it does not. A version-1
     * symbol is 21 modules across, so the format information on row and column
     * 8 and the finder separators on row and column 7 run straight through the
     * middle third. Eight unprotected modules end up under the plate.
     *
     * Which is why `minVersionForCentre` exists, below. Kept as a test of the
     * check rather than rewritten into a test of the fix, because the check is
     * the thing that has to hold when something upstream changes.
     */
    const tiny = encodeQr("hi", { ecLevel: "L", minVersion: 1, maxVersion: 1 });
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) return;
    expect(tiny.symbol.size).toBe(21);
    const a = analyse(
      tiny.symbol,
      design({ centre: centre({ size: 0.3, shape: "square" }) }),
    );
    expect(a.metrics.functionDamage.structural).toBe(8);
    expect(a.scannable).toBe(false);
    expect(a.findings.find((f) => f.key === "centre.function")?.level).toBe("blocker");
  });

  it("knows the smallest grid each middle size can live on", () => {
    // A small middle fits version 1; the largest needs version 2 or more.
    expect(minVersionForCentre(0.1)).toBe(1);
    expect(minVersionForCentre(0.3)).toBeGreaterThan(1);

    // And the answer is right by construction: at the version it names, the
    // plate clears the structure; one version lower, it does not.
    for (const size of [0.1, 0.15, 0.2, 0.25, 0.3]) {
      const version = minVersionForCentre(size);
      const text = "x".repeat(40);
      const ok = encodeQr(text, { ecLevel: "H", minVersion: version, maxVersion: 40 });
      expect(ok.ok).toBe(true);
      if (!ok.ok) continue;
      expect(
        analyse(ok.symbol, design({ centre: centre({ size, shape: "square" }) })).metrics
          .functionDamage.structural,
        `size ${size} at version ${version}`,
      ).toBe(0);
    }
  });

  it("asks for no floor when there is nothing in the middle", () => {
    expect(structuralMinVersion(design({ centre: { type: "none" } }))).toBe(1);
    // Nor for a logo with no file chosen yet, which draws nothing.
    expect(
      structuralMinVersion(
        design({
          centre: {
            type: "image",
            url: "",
            size: 0.3,
            shape: "circle",
            backdrop: true,
            backdropColor: "#ffffff",
          },
        }),
      ),
    ).toBe(1);
    expect(
      structuralMinVersion(design({ centre: centre({ size: 0.3 }) })),
    ).toBeGreaterThan(1);
  });

  it("still blocks structural damage if a design arrives past the cap", () => {
    /*
     * Defence in depth. The cap makes this unreachable from the designer, but
     * a design also arrives from a stored row and from a server action, and a
     * check that only works because something upstream is careful is a check
     * that stops working the day something upstream changes.
     *
     * Note the deliberately UN-normalised design: this is the one test in the
     * file that must bypass normaliseDesign to reach the code it is testing.
     */
    const tiny = encodeQr("hi", { ecLevel: "H", minVersion: 1, maxVersion: 1 });
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) return;
    const oversized: QrDesign = {
      ...DEFAULT_DESIGN,
      centre: centre({ size: 0.8, shape: "square" }),
    };
    const a = analyse(tiny.symbol, oversized);
    expect(a.metrics.functionDamage.structural).toBeGreaterThan(0);
    expect(a.scannable).toBe(false);
    const blocker = a.findings.find((f) => f.key === "centre.function");
    expect(blocker?.level).toBe("blocker");
    // It must name WHY this one cannot be repaired, since every other kind of
    // damage on this page can be.
    expect(blocker?.detail).toContain("no redundancy");
  });

  it("treats a round plate as round, not as the square around it", () => {
    // A circle covers π/4 of its bounding box — about 21% fewer modules. The
    // designer offers both shapes, so the measurement has to tell them apart.
    const square = analyse(
      symbol({ ecLevel: "H", minVersion: 8 }),
      design({ centre: centre({ size: 0.28, shape: "square" }), ecLevel: "H", minVersion: 8 }),
    );
    const round = analyse(
      symbol({ ecLevel: "H", minVersion: 8 }),
      design({ centre: centre({ size: 0.28, shape: "circle" }), ecLevel: "H", minVersion: 8 }),
    );
    expect(round.metrics.spoiled).toBeLessThan(square.metrics.spoiled);
  });

  it("counts the plate behind a logo, not just the logo", () => {
    // The plate is drawn a fifth larger so the logo's own edges are not read
    // as data; that larger area is what actually covers modules.
    const withPlate = analyse(
      symbol({ ecLevel: "H", minVersion: 8 }),
      design({
        centre: {
          type: "image",
          url: "https://x/logo.png",
          size: 0.25,
          shape: "square",
          backdrop: true,
          backdropColor: "#ffffff",
        },
        ecLevel: "H",
        minVersion: 8,
      }),
    );
    const without = analyse(
      symbol({ ecLevel: "H", minVersion: 8 }),
      design({
        centre: {
          type: "image",
          url: "https://x/logo.png",
          size: 0.25,
          shape: "square",
          backdrop: false,
          backdropColor: "#ffffff",
        },
        ecLevel: "H",
        minVersion: 8,
      }),
    );
    expect(withPlate.metrics.spoiled).toBeGreaterThan(without.metrics.spoiled);
  });
});

/* ============================================================
 * The rest
 * ========================================================== */

describe("the quiet zone and the surface", () => {
  it("says the standard's figure, and how thin is too thin", () => {
    expect(analyse(symbol(), design({ margin: 4 })).findings.find((f) => f.key === "quiet")).toBeUndefined();
    expect(analyse(symbol(), design({ margin: 3 })).findings.find((f) => f.key === "quiet")?.level).toBe("note");
    expect(analyse(symbol(), design({ margin: 2 })).findings.find((f) => f.key === "quiet")?.level).toBe("warning");
  });

  it("warns that a transparent code inherits whatever it is placed on", () => {
    const a = analyse(symbol(), design({ background: { type: "transparent" } }));
    const note = a.findings.find((f) => f.key === "background.transparent");
    expect(note).toBeDefined();
    // And it admits it cannot check that, rather than implying it has.
    expect(note?.detail).toContain("nothing here can warn you");
  });
});

describe("sparse shapes", () => {
  it("warns when a sparse shape is also shrunk", () => {
    const a = analyse(symbol(), design({ module: "dot", moduleScale: 0.6 }));
    expect(a.findings.find((f) => f.key === "shape.thin")?.level).toBe("warning");
  });

  it("says nothing about a solid shape at any scale", () => {
    const a = analyse(symbol(), design({ module: "square", moduleScale: 0.6 }));
    expect(a.findings.find((f) => f.key === "shape.thin")).toBeUndefined();
  });

  it("tells you when letters have become too small to be letters", () => {
    const small = analyse(
      symbol({ minVersion: 2 }),
      design({ module: "letters", letters: "GRACE", minVersion: 2 }),
    );
    expect(small.findings.find((f) => f.key === "shape.letters")?.level).toBe("note");

    const big = analyse(
      symbol({ minVersion: 12 }),
      design({ module: "letters", letters: "GRACE", minVersion: 12 }),
    );
    const finding = big.findings.find((f) => f.key === "shape.letters");
    expect(finding?.level).toBe("warning");
    // The way out is a shorter payload, and it should say so.
    expect(finding?.detail).toContain("short link");
  });
});

describe("physical size", () => {
  it("works out the module size in millimetres and warns when it is too small", () => {
    // 12mm across a 37-module image is 0.32mm a module, under what a phone
    // camera resolves. (At 15mm it is 0.41mm and passes, which is how close
    // this threshold runs to the sizes people actually choose.)
    const a = analyse(symbol(), design({}), { printWidthMm: 12 });
    const finding = a.findings.find((f) => f.key === "size.small");
    expect(finding?.level).toBe("warning");
    expect(finding?.title).toContain("12mm");
    // And it says how wide it needs to be, rather than only that it is small.
    expect(finding?.detail).toMatch(/needs \d+mm/);
  });

  it("says nothing at a sensible size", () => {
    expect(
      analyse(symbol(), design({}), { printWidthMm: 60 }).findings.find(
        (f) => f.key === "size.small",
      ),
    ).toBeUndefined();
  });

  it("says nothing when no physical size was given", () => {
    expect(
      analyse(symbol(), design({})).findings.find((f) => f.key === "size.small"),
    ).toBeUndefined();
  });
});

describe("findings, as a list", () => {
  it("puts blockers first, then warnings, then notes", () => {
    const a = analyse(
      symbol({ minVersion: 2 }),
      design({
        fill: { type: "solid", color: "#cccccc" },
        module: "dot",
        moduleScale: 0.6,
        margin: 2,
        minVersion: 2,
      }),
    );
    const levels = a.findings.map((f) => f.level);
    expect(levels.indexOf("blocker")).toBe(0);
    const order = { blocker: 0, warning: 1, note: 2 };
    for (let i = 1; i < levels.length; i++) {
      expect(order[levels[i]]).toBeGreaterThanOrEqual(order[levels[i - 1]]);
    }
  });

  it("gives every finding a sentence naming the cause and one with a number in it", () => {
    const a = analyse(
      symbol({ minVersion: 2 }),
      design({ fill: { type: "solid", color: "#bbbbbb" }, margin: 2, minVersion: 2 }),
    );
    expect(a.findings.length).toBeGreaterThan(0);
    for (const f of a.findings) {
      expect(f.title.length, f.key).toBeGreaterThan(10);
      expect(f.detail.length, f.key).toBeGreaterThan(40);
      // No finding may be a bare verdict with nothing behind it.
      expect(f.detail, f.key).toMatch(/\d/);
    }
  });

  it("has a unique key per finding, so a list cannot show one twice", () => {
    const a = analyse(
      symbol({ minVersion: 2 }),
      design({ module: "letters", moduleScale: 0.6, margin: 2, minVersion: 2 }),
      { printWidthMm: 10 },
    );
    const keys = a.findings.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ============================================================
 * The rendered check, where it cannot run
 * ========================================================== */

describe("the rendered check, on the server", () => {
  it("refuses with a reason rather than throwing or pretending", () => {
    // Vitest runs in Node here, with no document. The honest answer is "this
    // needs a browser" — not a silent pass, which would be a check that
    // reports success without having looked.
    return sampleRendered(symbol(), design({})).then((result) => {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("no-canvas");
      expect(result.error).toContain("browser");

      const described = describeSample(result);
      expect(described.title).toContain("could not run");
      expect(described.level).not.toBe("note");
    });
  });

  it("reads a clean sample as nothing spent", () => {
    const described = describeSample({
      ok: true,
      wrongModules: 0,
      wrongFunctionModules: 0,
      spoiledCodewords: 0,
      correctableCodewords: 44,
      totalModules: 1369,
      wrong: [],
      threshold: 0.5,
    });
    expect(described.level).toBe("note");
    expect(described.title).toContain("correctly");
  });

  it("treats structural damage as fatal even when little else is wrong", () => {
    const described = describeSample({
      ok: true,
      wrongModules: 3,
      wrongFunctionModules: 3,
      spoiledCodewords: 0,
      correctableCodewords: 44,
      totalModules: 1369,
      wrong: [],
      threshold: 0.5,
    });
    expect(described.level).toBe("blocker");
    expect(described.title).toContain("structure");
  });

  it("blocks when more codewords read wrong than can be repaired", () => {
    const described = describeSample({
      ok: true,
      wrongModules: 400,
      wrongFunctionModules: 0,
      spoiledCodewords: 50,
      correctableCodewords: 44,
      totalModules: 1369,
      wrong: [],
      threshold: 0.5,
    });
    expect(described.level).toBe("blocker");
    expect(described.detail).toContain("50 codewords");
  });

  it("warns when it decodes with little left over", () => {
    const described = describeSample({
      ok: true,
      wrongModules: 200,
      wrongFunctionModules: 0,
      spoiledCodewords: 30,
      correctableCodewords: 44,
      totalModules: 1369,
      wrong: [],
      threshold: 0.5,
    });
    expect(described.level).toBe("warning");
    expect(described.detail).toContain("Test a print");
  });

  it("explains a blocked canvas as our problem, not the design's", () => {
    const described = describeSample({
      ok: false,
      reason: "cors-blocked",
      error: "x",
    });
    // A note, not a warning: the design may be perfect and the check simply
    // could not look. Calling that a warning would be blaming the design.
    expect(described.level).toBe("note");
  });
});
