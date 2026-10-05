/**
 * Read the finished picture back, the way a scanner does.
 *
 * `verify.ts` can be exact about geometry and about colours it was given. It
 * cannot be exact about a photograph — whether a code whose modules are
 * windows onto last Sunday's service photo actually reads depends entirely on
 * that photograph, and no amount of reasoning about the settings will say.
 *
 * So this does what a scanner does: rasterise the image, sample each module
 * near its middle, threshold, and compare what came back against what was
 * encoded. The result is a count of modules that read WRONG, and — through the
 * codeword map — the number of codewords that would actually have to be
 * repaired. That is the same budget the logo is measured against, so one
 * number covers the photograph, the logo, the contrast and the shape together.
 *
 * It lives in its own file because it needs a browser: a canvas, an image
 * decoder, a document. `verify.ts` stays pure and testable, and this is the
 * instrument you reach for when the pure answer is "it depends".
 *
 * IT REPORTS WHY IT COULD NOT MEASURE. Three things genuinely stop it: an
 * image that will not load, an image served without CORS headers (which taints
 * the canvas, so reading pixels back throws), and a browser with no canvas at
 * all. Each returns its own reason. An empty catch here would be the worst
 * possible place for one — the whole point of this function is to be the thing
 * that tells you the truth about a design that looks fine.
 */

import { codewordMap, moduleAt, Role, type QrSymbol } from "@/lib/qr/encode";
import type { QrDesign } from "@/lib/qr/design";
import { layoutFor, renderSvg, svgDataUrl } from "@/lib/qr/render";
import { inlineDesignImages, needsInlining } from "@/lib/qr/inline-images";

/** Pixels per module when rasterising. Eight is plenty and stays fast. */
const SAMPLES_PER_MODULE = 8;

export type SampleResult =
  | {
      ok: true;
      /** Modules whose sampled value disagrees with the encoded one. */
      wrongModules: number;
      /** Of those, how many are function patterns — unrepairable. */
      wrongFunctionModules: number;
      /** Distinct codewords that would need repairing. */
      spoiledCodewords: number;
      /** What the correction level can repair. */
      correctableCodewords: number;
      totalModules: number;
      /** Where the mismatches are, for drawing over the preview. */
      wrong: { x: number; y: number }[];
      /** The luminance threshold used to split dark from light. */
      threshold: number;
    }
  | { ok: false; reason: "no-canvas" | "image-failed" | "cors-blocked" | "timeout"; error: string };

/**
 * Rasterise the design and read its modules back.
 *
 * `svg` is optional: pass the exact markup already on screen so that what is
 * measured is what is displayed. Without it the same renderer is called again,
 * which is deterministic and therefore equivalent.
 */
export async function sampleRendered(
  symbol: QrSymbol,
  design: QrDesign,
  svg?: string,
): Promise<SampleResult> {
  if (typeof document === "undefined") {
    return {
      ok: false,
      reason: "no-canvas",
      error: "This check needs a browser; it cannot run on the server.",
    };
  }

  const layout = layoutFor(symbol, design);

  /*
   * The markup passed in is the one on screen, where the logo is a LINK to our
   * CDN. That link resolves in the page and is silently ignored once the same
   * markup goes through `new Image()` — so measuring it would measure a code
   * with a hole where the logo is, and call it clean. The picture has to be
   * made self-contained before it means anything. See inline-images.ts.
   */
  let drawable = design;
  if (needsInlining(design)) {
    const inlined = await inlineDesignImages(design);
    if (!inlined.ok) {
      return {
        ok: false,
        reason: "image-failed",
        error: inlined.error,
      };
    }
    drawable = inlined.design;
  }
  const markup = drawable === design && svg ? svg : renderSvg(symbol, drawable);
  const width = Math.round(layout.width * SAMPLES_PER_MODULE);
  const height = Math.round(layout.height * SAMPLES_PER_MODULE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      ok: false,
      reason: "no-canvas",
      error: "This browser would not give us a canvas to draw on, so the picture cannot be measured.",
    };
  }

  /*
   * A white ground before drawing. A transparent background would sample as
   * transparent black, which reads as a dark module everywhere there is
   * nothing — the opposite of what a transparent code on paper does.
   */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const loaded = await loadImage(svgDataUrl(markup), width, height);
  if (!loaded.ok) return loaded;
  ctx.drawImage(loaded.image, 0, 0, width, height);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch (error) {
    /*
     * Almost always a tainted canvas: an <image> inside the SVG pointed at a
     * host that did not send Access-Control-Allow-Origin, so the browser
     * refuses to let the pixels be read. Said plainly, because the design is
     * not the problem and changing it will not help.
     *
     * Logged as well as classified. The sentence below is the right thing to
     * SHOW and it is a guess about the cause; the exception itself is the only
     * thing that could ever correct that guess, so it goes to the console
     * rather than being discarded.
     */
    console.error("[qr] could not read the rendered picture back", error);
    return {
      ok: false,
      reason: "cors-blocked",
      error:
        "The picture was drawn, but the browser will not let us read its pixels back, because one of the images in it is served from a host that does not allow it. The code itself is fine — this check is what cannot run. Upload the image to your media library and use it from there, and the check will work.",
    };
  }

  /* ---------------------------------------------------- threshold */
  const grid = new Float64Array(symbol.size * symbol.size);
  let min = 1;
  let max = 0;
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      const value = sampleModule(pixels, width, layout, x, y);
      grid[y * symbol.size + x] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  /*
   * The midpoint between the darkest and lightest module, which is what a
   * scanner's adaptive threshold converges on over a small region. A fixed 0.5
   * would call every module of a low-contrast design "light" and report the
   * code as half missing, which is true of the design and useless as a
   * diagnosis.
   */
  const threshold = (min + max) / 2;

  const map = codewordMap(symbol);
  const spoiled = new Set<number>();
  const wrong: { x: number; y: number }[] = [];
  let wrongFunctionModules = 0;

  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      const at = y * symbol.size + x;
      const readDark = grid[at] < threshold;
      if (readDark === moduleAt(symbol, x, y)) continue;
      wrong.push({ x, y });
      if (symbol.roles[at] !== Role.Data) wrongFunctionModules++;
      const cw = map[at];
      if (cw >= 0) spoiled.add(cw);
    }
  }

  return {
    ok: true,
    wrongModules: wrong.length,
    wrongFunctionModules,
    spoiledCodewords: spoiled.size,
    correctableCodewords: symbol.plan.correctableCodewords,
    totalModules: symbol.size * symbol.size,
    wrong,
    threshold,
  };
}

/**
 * The average luminance of the middle of a module.
 *
 * The middle half of the cell, not the whole cell and not one pixel. One pixel
 * lands in a gap between two halves of a decorative shape and reads wrong; the
 * whole cell averages in the white around a dot and reads every dot as light.
 * A scanner looks at a small patch around the centre, so this does too.
 */
function sampleModule(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  layout: ReturnType<typeof layoutFor>,
  x: number,
  y: number,
): number {
  const px = (layout.offsetX + x) * SAMPLES_PER_MODULE;
  const py = (layout.offsetY + y) * SAMPLES_PER_MODULE;
  const from = Math.floor(SAMPLES_PER_MODULE * 0.25);
  const to = Math.ceil(SAMPLES_PER_MODULE * 0.75);

  let total = 0;
  let count = 0;
  for (let dy = from; dy < to; dy++) {
    for (let dx = from; dx < to; dx++) {
      const i = ((Math.round(py) + dy) * canvasWidth + Math.round(px) + dx) * 4;
      if (i < 0 || i + 2 >= pixels.length) continue;
      // Rec. 601 luma: close enough to what a camera's sensor does, and the
      // weighting is what keeps a saturated blue from reading as light.
      total += (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
      count++;
    }
  }
  return count ? total / count : 1;
}

function loadImage(
  src: string,
  width: number,
  height: number,
): Promise<{ ok: true; image: HTMLImageElement } | Extract<SampleResult, { ok: false }>> {
  return new Promise((resolve) => {
    const image = new Image();
    image.width = width;
    image.height = height;
    /*
     * `anonymous` so that a CORS-enabled host (Cloudinary sends the header)
     * produces an untainted canvas. Without it EVERY external image taints
     * the canvas, including ones that would have been allowed.
     */
    image.crossOrigin = "anonymous";

    const timer = setTimeout(() => {
      resolve({
        ok: false,
        reason: "timeout",
        error:
          "The picture took more than ten seconds to draw, which usually means an image in it is on a slow or unreachable host.",
      });
    }, 10_000);

    image.onload = () => {
      clearTimeout(timer);
      resolve({ ok: true, image });
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: "image-failed",
        error:
          "One of the images in the design would not load, so the finished picture could not be measured. Check that the logo or photograph is still in your media library.",
      });
    };
    image.src = src;
  });
}

/**
 * The sampled result as the same sentences the rest of the checks speak.
 *
 * Deliberately a separate step from the measurement: the numbers above are
 * what they are, and this is one interpretation of them. Keeping them apart
 * means the raw figures are always on screen next to the verdict, which is the
 * only way a person can disagree with the verdict.
 */
export function describeSample(result: SampleResult): {
  level: "blocker" | "warning" | "note";
  title: string;
  detail: string;
} {
  if (!result.ok) {
    return {
      level: result.reason === "cors-blocked" ? "note" : "warning",
      title: "This check could not run",
      detail: result.error,
    };
  }

  const { wrongModules, wrongFunctionModules, spoiledCodewords, correctableCodewords, totalModules } =
    result;

  if (wrongModules === 0) {
    return {
      level: "note",
      title: "Every module read back correctly",
      detail: `All ${totalModules.toLocaleString()} modules of the finished picture were read exactly as encoded, with none of the error correction spent. Whatever else this design is doing, it is not costing the code anything.`,
    };
  }

  if (wrongFunctionModules > 0) {
    return {
      level: "blocker",
      title: "The finished picture breaks the code's structure",
      detail: `${wrongFunctionModules} module${wrongFunctionModules === 1 ? "" : "s"} of finder pattern, timing line or format information read back wrong. Error correction does not protect those, so a scanner will not find the symbol at all. Something in the design — most likely an image, or the middle — is sitting over them.`,
    };
  }

  if (spoiledCodewords > correctableCodewords) {
    return {
      level: "blocker",
      title: "The finished picture reads back too damaged to decode",
      detail: `${wrongModules} modules read wrong, which is ${spoiledCodewords} codewords, and this correction level repairs ${correctableCodewords}. Raise the correction level, lighten the background's photograph, or make the middle smaller.`,
    };
  }

  const headroom = correctableCodewords - spoiledCodewords;
  if (spoiledCodewords > correctableCodewords * 0.5) {
    return {
      level: "warning",
      title: "It decodes, with little left over",
      detail: `${wrongModules} modules read wrong — ${spoiledCodewords} codewords of the ${correctableCodewords} this level can repair, leaving ${headroom}. That is enough on a screen and thin on paper, where a crease or a glare spends the rest. Test a print.`,
    };
  }

  return {
    level: "note",
    title: "It decodes with room to spare",
    detail: `${wrongModules} of ${totalModules.toLocaleString()} modules read wrong, which is ${spoiledCodewords} codewords; this level repairs ${correctableCodewords}, so ${headroom} are left for creases, glare and a cheap camera.`,
  };
}
