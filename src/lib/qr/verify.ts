/**
 * Will this code actually scan?
 *
 * A beautiful QR code that does not scan is worse than an ugly one, and the
 * failure arrives weeks later, on four hundred printed flyers, with nothing in
 * the preview having looked wrong. Every QR generator with decorative options
 * has this problem and almost none of them say anything about it; the ones
 * that do say "logo too large" with no number behind it.
 *
 * TWO LAYERS, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   `analyse` is pure arithmetic over the design and the symbol. It runs on
 *   every keystroke, it works in Node, and it is what gates saving. It can be
 *   exact about geometry and colour, which is most of what goes wrong.
 *
 *   `sampleRendered` (in `verify-render.ts`, browser only) rasterises the
 *   finished picture and reads the modules back out of the pixels. It is the
 *   only thing that can judge a photograph fill, because the contrast there
 *   depends on the photograph.
 *
 * REPORTS NUMBERS, NOT VERDICTS. "Poor contrast" cannot be acted on. "2.1:1
 * between #6b7280 and #9ca3af — a scanner needs about 3:1, and 7:1 to work in
 * a dim foyer" can. Every finding carries the measurement that produced it.
 */

import {
  damagedFunctionModules,
  spoiledCodewords,
  type QrSymbol,
} from "@/lib/qr/encode";
import {
  SPARSE_SHAPES,
  backgroundColors,
  contrastRatio,
  fillColors,
  luminance,
  type QrDesign,
} from "@/lib/qr/design";
import { EC_LABEL } from "@/lib/qr/tables";
import { centreBox, layoutFor } from "@/lib/qr/render";

/* ============================================================
 * Thresholds
 *
 * Written down with their reasons, because a number in a condition with no
 * note beside it is a number nobody can ever change with confidence.
 * ========================================================== */

/**
 * Below this a code does not reliably scan at all. A camera thresholds the
 * image before it does anything else, and under about 3:1 the two states are
 * within the sensor's own noise in anything but bright light.
 */
const CONTRAST_FLOOR = 3;

/**
 * Above this, contrast stops being the thing that decides.
 *
 * CALIBRATED RATHER THAN BORROWED. This started at 7:1, which is WCAG's AAA
 * threshold for body text — and the first run of the preset tests flagged five
 * of twelve shipped presets as "test a print", including an ordinary brand
 * indigo on white at 6.1:1 that every phone reads instantly. A checker that
 * warns about things that work teaches people to ignore it, and then it is not
 * there for the warning that matters.
 *
 * A QR module is an enormous glyph by comparison with text and is read by an
 * adaptive threshold, not by an eye. 4.5:1 is where a mid-tone brand colour on
 * white sits, and those scan; below it, in a dim foyer at an angle, they start
 * to need a second try.
 */
const CONTRAST_OK = 4.5;

/** Comfortable anywhere: a dim foyer, at an angle, on a phone from 2019. */
const CONTRAST_GOOD = 10;

/**
 * How much of the error-correction budget a decoration may spend.
 *
 * The budget exists to survive the WORLD — a crease, a glare, a thumb, a cheap
 * printer, a camera at 40°. Spending all of it on a logo leaves a code that
 * scans perfectly on screen and fails on paper, which is the single most
 * common way this feature disappoints. Half is the line: generous enough for a
 * logo at the sizes churches actually want, and it keeps half the redundancy
 * for the reason it was put there.
 */
const DECORATION_BUDGET = 0.5;

/** A module smaller than this on paper is below what a phone camera resolves. */
const MIN_MODULE_MM = 0.4;

export type FindingLevel = "blocker" | "warning" | "note";

export type Finding = {
  level: FindingLevel;
  /** A stable key, so a UI can treat one finding specially without matching text. */
  key: string;
  /** One sentence naming the cause. */
  title: string;
  /** The measurement, and what to do. Never "something is wrong". */
  detail: string;
};

export type Analysis = {
  findings: Finding[];
  /** False when any finding is a blocker. */
  scannable: boolean;
  /** The numbers the UI shows as numbers rather than as prose. */
  metrics: {
    /** The worst contrast ratio between a module colour and the background. */
    contrast: number | null;
    /** Codewords the decoration spoils. */
    spoiled: number;
    /** Codewords the correction level can repair. */
    correctable: number;
    /** Codewords left for the world, after the decoration. */
    headroom: number;
    /**
     * Function-pattern modules covered, split by consequence.
     *
     * `structural` is fatal — the eyes, the timing lines and the format strip
     * are how a scanner finds and reads the symbol, and nothing repairs them.
     * `alignment` is survivable: a decoder estimates the grid from the finder
     * patterns where an alignment ring is missing. See the note on
     * `damagedFunctionModules` in encode.ts for why counting them together
     * produced a wrong answer.
     */
    functionDamage: { structural: number; alignment: number };
    version: number;
    /** Total modules across, including the quiet zone and any frame. */
    across: number;
  };
};

/* ============================================================
 * Geometry of the decoration
 * ========================================================== */

/**
 * Is module (x, y) under the centre overlay?
 *
 * The overlay's PLATE is what covers modules, not the logo: the plate is drawn
 * a fifth larger so the logo's own edges are not read as data. So the plate is
 * what is measured, and a module counts as covered if the plate reaches its
 * middle — which is where a scanner samples.
 */
function centreCovers(
  symbol: QrSymbol,
  design: QrDesign,
): ((x: number, y: number) => boolean) | null {
  // An image centre with no file chosen yet draws nothing, so it must cost
  // nothing. Otherwise picking "logo" before picking the logo reports a budget
  // spent on something invisible.
  if (design.centre.type === "image" && !design.centre.url) return null;

  const layout = layoutFor(symbol, design);
  const box = centreBox(symbol, design, layout);
  if (!box) return null;

  const grown =
    design.centre.type === "image" && design.centre.backdrop ? 1.18 : 1;
  const size = box.size * grown;
  // Back into symbol-local coordinates, since the caller walks the symbol.
  const x0 = box.x - layout.offsetX - (size - box.size) / 2;
  const y0 = box.y - layout.offsetY - (size - box.size) / 2;
  const circleShape = design.centre.type !== "none" && design.centre.shape === "circle";
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const r = size / 2;

  return (x: number, y: number): boolean => {
    const mx = x + 0.5;
    const my = y + 0.5;
    if (circleShape) {
      return (mx - cx) ** 2 + (my - cy) ** 2 <= r * r;
    }
    return mx >= x0 && mx <= x0 + size && my >= y0 && my <= y0 + size;
  };
}

/* ============================================================
 * The analysis
 * ========================================================== */

export type AnalyseOptions = {
  /**
   * The width this will be printed or displayed at, in millimetres.
   *
   * Optional because a code on a screen has no physical size. When it is
   * known, the module size in millimetres is the single most useful number
   * here — more codes fail from being printed too small than from any
   * decorative choice.
   */
  printWidthMm?: number;
};

export function analyse(
  symbol: QrSymbol,
  design: QrDesign,
  options: AnalyseOptions = {},
): Analysis {
  const findings: Finding[] = [];
  const layout = layoutFor(symbol, design);

  /* ---------------------------------------------------- contrast */
  const inks = fillColors(design.fill);
  const papers = backgroundColors(design.background);
  let contrast: number | null = null;

  if (inks.length === 0 || papers.length === 0) {
    findings.push({
      level: "note",
      key: "contrast.unknowable",
      title: "Contrast cannot be judged from the settings alone",
      detail:
        design.fill.type === "image"
          ? "The modules are filled with a photograph, so how dark they are depends on the photograph. Use “Check it the way a scanner sees it” — that reads the finished picture back, pixel by pixel, which is the only honest answer here."
          : "The background is a photograph showing through the veil, so the contrast varies across the code. Use “Check it the way a scanner sees it” to measure the finished picture.",
    });
  } else {
    for (const ink of inks) {
      for (const paper of papers) {
        const ratio = contrastRatio(ink, paper);
        if (contrast === null || ratio < contrast) contrast = ratio;
      }
    }
    if (contrast !== null && contrast < CONTRAST_FLOOR) {
      findings.push({
        level: "blocker",
        key: "contrast.floor",
        title: "Not enough contrast to scan",
        detail: `The darkest module and the background are only ${contrast.toFixed(1)}:1 apart. A camera needs about ${CONTRAST_FLOOR}:1 to tell them apart at all, and ${CONTRAST_OK}:1 to manage it in a dim foyer on an old phone. Darken the modules or lighten the background.`,
      });
    } else if (contrast !== null && contrast < CONTRAST_OK) {
      findings.push({
        level: "warning",
        key: "contrast.low",
        title: "This will scan on a good phone in good light, and struggle otherwise",
        detail: `${contrast.toFixed(1)}:1 between the modules and the background. Above ${CONTRAST_OK}:1 it stops mattering which phone or what light; a church foyer is dimmer than the screen you are choosing this on.`,
      });
    }
  }

  /* ---------------------------------------------------- inversion */
  if (inks.length && papers.length) {
    const darkestInk = Math.min(...inks.map(luminance));
    const lightestPaper = Math.max(...papers.map(luminance));
    if (darkestInk > lightestPaper) {
      findings.push({
        level: "warning",
        key: "inverted",
        title: "Light modules on a dark background",
        detail:
          "Most phone cameras read this fine. Some older handheld scanners and a few till systems refuse an inverted code outright, because the standard does not require them to handle it. If it is going anywhere other than a phone, test it on that device first.",
      });
    }
  }

  /* ---------------------------------------------------- the decoration */
  const covers = centreCovers(symbol, design);
  const spoiled = covers ? spoiledCodewords(symbol, covers) : 0;
  const functionDamage = covers
    ? damagedFunctionModules(symbol, covers)
    : { structural: 0, alignment: 0 };
  const correctable = symbol.plan.correctableCodewords;
  const allowance = Math.floor(correctable * DECORATION_BUDGET);
  const headroom = correctable - spoiled;

  if (functionDamage.structural > 0) {
    const n = functionDamage.structural;
    findings.push({
      level: "blocker",
      key: "centre.function",
      title: "The middle is covering part of the code's structure",
      detail: `${n} module${n === 1 ? "" : "s"} of finder pattern, timing line or format information ${n === 1 ? "is" : "are"} underneath it. Those carry no redundancy at all — they are how a scanner finds and reads the symbol — so nothing can repair them. Make the middle smaller, or use a denser grid so there is more code around it.`,
    });
  }

  if (functionDamage.alignment > 0) {
    /*
     * A note, not a warning, and the difference is load-bearing.
     *
     * From version 7 to 13 there is an alignment ring AT THE CENTRE of the
     * symbol, so any middle on a code that size covers it. Counting that with
     * the fatal patterns made every logo on a version 10 code read as
     * unscannable, which is wrong: a decoder estimates the grid from the
     * finder patterns where an alignment ring is missing, and every
     * commercial generator puts logos on codes this size.
     *
     * It is not nothing either, which is why it is said at all: the rings
     * exist to correct perspective, so what is lost is tolerance for a steep
     * angle or a curved surface.
     */
    findings.push({
      level: "note",
      key: "centre.alignment",
      title: "The middle sits over one of the small alignment squares",
      detail: `Unavoidable at this size — versions 7 to 13 of the standard put one of them exactly in the centre. A phone photographing the code flat reads the grid from the three corner squares instead, which is why this is normal rather than a fault. What it costs is tolerance for a steep angle or a curved surface, so keep it off a mug or a lamp post.`,
    });
  }

  if (covers && spoiled > correctable) {
    findings.push({
      level: "blocker",
      key: "centre.overbudget",
      title: "The middle covers more than the code can recover",
      detail: `It spoils ${spoiled} of the ${symbol.plan.totalCodewords} codewords, and ${EC_LABEL[symbol.ecLevel]} correction repairs at most ${correctable}. Either make it smaller, raise the correction level, or raise “Smallest grid” — a denser grid has more codewords, so the same logo costs proportionally less.`,
    });
  } else if (covers && spoiled > allowance) {
    findings.push({
      level: "warning",
      key: "centre.tight",
      title: "This will scan from a screen, and may fail on paper",
      detail: `The middle spoils ${spoiled} codewords and ${EC_LABEL[symbol.ecLevel]} correction repairs ${correctable}, leaving ${headroom} for everything else. Error correction is what survives a crease, a glare, a thumb over the corner and a cheap printer — so about half of it (${allowance}) is as much as a decoration should take. It is fine on a screen; test a print before ordering any.`,
    });
  } else if (covers && spoiled > 0) {
    findings.push({
      level: "note",
      key: "centre.fine",
      title: "There is room for the middle",
      detail: `It spoils ${spoiled} of ${symbol.plan.totalCodewords} codewords; ${EC_LABEL[symbol.ecLevel]} correction repairs up to ${correctable}, so ${headroom} are left for creases, glare and a cheap camera.`,
    });
  }

  /* ---------------------------------------------------- quiet zone */
  if (design.margin < 4) {
    findings.push({
      level: design.margin < 3 ? "warning" : "note",
      key: "quiet",
      title: "The border around the code is thinner than the standard asks for",
      detail: `${design.margin} modules; the standard says 4. A thin border is usually fine on a plain page and fails when the code is printed up against a photograph, a rule or a dark block of colour — the scanner cannot tell where the code ends.`,
    });
  }

  if (design.background.type === "transparent") {
    findings.push({
      level: "note",
      key: "background.transparent",
      title: "No background of its own",
      detail:
        "Whatever this is placed on becomes the background, including the quiet zone. On white it is perfect. On a photograph or a coloured block it will not scan, and nothing here can warn you at that point — so place it on a plain, light area.",
    });
  }

  /* ---------------------------------------------------- sparse shapes */
  const sparse = SPARSE_SHAPES.includes(design.module);
  if (sparse && design.moduleScale < 0.85) {
    findings.push({
      level: "warning",
      key: "shape.thin",
      title: "These modules are both a sparse shape and shrunk",
      detail: `${Math.round(design.moduleScale * 100)}% of each cell, in a shape that already leaves white around it. A scanner decides a module is dark by looking near its middle, so this still works on screen and gets fragile on paper at small sizes. Either go back to full size or choose a solid shape.`,
    });
  }

  if (design.module === "letters") {
    const dark = countDark(symbol);
    findings.push({
      level: symbol.version > 6 ? "warning" : "note",
      key: "shape.letters",
      title:
        symbol.version > 6
          ? "At this size the letters will not be readable"
          : "Letters read as letters at this size",
      detail:
        symbol.version > 6
          ? `There are ${dark} letters in a grid ${symbol.size} modules across, so each one is tiny — the effect is lost and it just looks noisy. Shorten what the code points at (a short link is the easy way) or use a solid shape instead.`
          : `${dark} letters across a ${symbol.size}-module grid. Print it at least ${Math.ceil(symbol.size * 1.2)}mm wide for them to be legible rather than decorative.`,
    });
  }

  if (design.eyeFrame === "dotted") {
    findings.push({
      level: "note",
      key: "eye.dotted",
      title: "Dotted eyes are the most decorative choice here",
      detail:
        "The dots sit exactly on the real pattern's modules, so the geometry a scanner locates is unchanged — but it is the least margin of any eye style. Worth a scan from two phones before it goes to print.",
    });
  }

  /* ---------------------------------------------------- physical size */
  if (options.printWidthMm && options.printWidthMm > 0) {
    const perModule = options.printWidthMm / layout.width;
    if (perModule < MIN_MODULE_MM) {
      const needed = Math.ceil(layout.width * MIN_MODULE_MM);
      findings.push({
        level: "warning",
        key: "size.small",
        title: `At ${options.printWidthMm}mm wide each module is ${perModule.toFixed(2)}mm`,
        detail: `Under about ${MIN_MODULE_MM}mm a phone camera cannot resolve the modules however good the design is. This code needs ${needed}mm to be comfortable. More codes fail from being printed too small than from anything else on this page — shortening what it points at makes the grid smaller and the modules bigger.`,
      });
    }
  }

  return {
    findings: findings.sort((a, b) => weight(a.level) - weight(b.level)),
    scannable: !findings.some((f) => f.level === "blocker"),
    metrics: {
      contrast,
      spoiled,
      correctable,
      headroom,
      functionDamage,
      version: symbol.version,
      across: layout.width,
    },
  };
}

function weight(level: FindingLevel): number {
  return level === "blocker" ? 0 : level === "warning" ? 1 : 2;
}

function countDark(symbol: QrSymbol): number {
  let dark = 0;
  for (let i = 0; i < symbol.modules.length; i++) dark += symbol.modules[i];
  return dark;
}

/* ============================================================
 * Saying it in one line
 * ========================================================== */

export type Confidence = "blocked" | "screen-only" | "good" | "excellent";

/**
 * One phrase for the whole analysis, for a badge beside the preview.
 *
 * Four states rather than two, because "will it scan" has a genuinely useful
 * middle: a code that works on a screen and not on paper is the commonest
 * outcome of a bold design, and collapsing it into either "fine" or "broken"
 * is how churches end up printing the broken one.
 */
export function confidenceOf(analysis: Analysis): Confidence {
  if (!analysis.scannable) return "blocked";
  if (analysis.findings.some((f) => f.level === "warning")) return "screen-only";
  const { contrast, spoiled, correctable } = analysis.metrics;
  const clean = contrast === null || contrast >= CONTRAST_GOOD;
  const roomy = correctable === 0 || spoiled <= correctable * 0.25;
  return clean && roomy ? "excellent" : "good";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  blocked: "Will not scan",
  "screen-only": "Scans on screen — test a print",
  good: "Scans",
  excellent: "Scans anywhere",
};

export const CONFIDENCE_TONE: Record<Confidence, string> = {
  blocked: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "screen-only": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  good: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  excellent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const FINDING_TONE: Record<FindingLevel, string> = {
  blocker: "border-rose-500/40 bg-rose-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  note: "border-border bg-muted/40",
};
