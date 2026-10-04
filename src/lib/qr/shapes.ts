/**
 * The geometry: one module, one eye, one icon, as SVG path data.
 *
 * Separated from `render.ts` because these are the only functions in the
 * module that are pure arithmetic over a unit cell, and they are the ones
 * worth testing on their own — a shape that strays outside its cell shows up
 * as a code that will not scan, not as a shape that looks wrong.
 *
 * EVERY SHAPE STAYS INSIDE ITS CELL. A scanner samples near a module's centre,
 * so a shape may be smaller than its cell and may touch the edges, but a shape
 * that bleeds over them merges with its neighbour and turns two modules into
 * one. `shapes.test.ts` checks the bounding box of every shape at every scale.
 *
 * Coordinates are in module units throughout; `render.ts` scales once at the
 * end by setting the viewBox, which keeps the numbers in the path readable and
 * the output resolution-independent.
 */

import type { EyeBall, EyeFrame, ModuleShape } from "@/lib/qr/design";

/** Trim a number to three decimals — plenty for a vector, and far smaller. */
export function n(value: number): string {
  const rounded = q(value);
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Snap a number to the three-decimal grid the output is written on.
 *
 * Not cosmetic. These paths are built from RELATIVE moves — `h`, `v`, and arc
 * deltas — so rounding each delta independently lets the error accumulate
 * along the path. A vertical bar came out 1.001 modules tall that way: the
 * radius rounded up to 0.167 and the straight run between the two corners was
 * computed from the unrounded 0.16666, so the three pieces no longer summed to
 * the height. One thousandth of a module is harmless; the same mistake in a
 * shape with more segments is not, and a shape that overflows its cell merges
 * with its neighbour.
 *
 * So every builder below quantises its inputs FIRST and derives its straight
 * runs from the quantised radius. Then the pieces sum exactly, and
 * `shapes.test.ts` can assert the bound to a millionth rather than to a
 * tolerance nobody can justify.
 */
export function q(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ============================================================
 * Neighbours
 *
 * Several shapes need to know what is next to a module: `fluid` rounds a
 * corner only where both of its sides are open, which is what makes runs of
 * modules join into a single flowing form instead of a row of lozenges.
 * ========================================================== */

export type Neighbours = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export const NO_NEIGHBOURS: Neighbours = {
  up: false,
  down: false,
  left: false,
  right: false,
};

/* ============================================================
 * A module
 * ========================================================== */

/**
 * The path for one module at cell (x, y).
 *
 * `scale` shrinks the shape towards the cell's centre. `seed` is consumed only
 * by `mosaic`, and deterministically, so the same design always redraws the
 * same picture — a preview that reshuffles on every keystroke is unusable.
 */
export function modulePath(
  shape: ModuleShape,
  x: number,
  y: number,
  scale: number,
  neighbours: Neighbours = NO_NEIGHBOURS,
  seed = 1,
): string {
  // `mosaic` varies each module's own scale a little, within its cell.
  const raw = shape === "mosaic" ? scale * (0.72 + 0.28 * hash01(x, y, seed)) : scale;
  /*
   * Quantised here, once, so that every shape below derives its own geometry
   * from the SAME width the path will be written with. Deriving `w` from the
   * unrounded scale and `x0` from the rounded one is how a shape ends up a
   * thousandth wider than its cell.
   */
  const w = q(raw);
  const x0 = q(x + (1 - w) / 2);
  const y0 = q(y + (1 - w) / 2);
  const cx = q(x0 + w / 2);
  const cy = q(y0 + w / 2);
  const r = q(w / 2);

  switch (shape) {
    case "square":
    case "mosaic":
      return rect(x0, y0, w, w);

    case "rounded":
      return roundedRect(x0, y0, w, w, w * 0.28);

    case "squircle":
      return roundedRect(x0, y0, w, w, w * 0.45);

    case "dot":
      return circle(cx, cy, r);

    case "diamond":
      // Absolute coordinates, so there is nothing to accumulate.
      return `M${n(cx)} ${n(cy - r)}L${n(cx + r)} ${n(cy)}L${n(cx)} ${n(cy + r)}L${n(cx - r)} ${n(cy)}Z`;

    case "bar-v":
      // A third of a cell wide, full height, so vertical runs form clean rules.
      return roundedRect(cx - w / 6, y0, w / 3, w, w / 6);

    case "bar-h":
      return roundedRect(x0, cy - w / 6, w, w / 3, w / 6);

    case "cross":
      return crossPath(cx, cy, r, 0.36);

    case "star":
      return starPath(cx, cy, r, r * 0.45, 5);

    case "heart":
      return heartPath(cx, cy, r);

    case "leaf":
      // A square with two opposite corners rounded hard: a pointed leaf.
      return leafPath(x0, y0, w, w * 0.5);

    case "fluid":
      return fluidPath(x0, y0, w, w * 0.5, neighbours);

    case "letters":
      // Letters are drawn as text, not as a path — `render.ts` handles them.
      // A filled cell is returned so a caller that ignores that still produces
      // a scannable code rather than an empty one.
      return rect(x0, y0, w, w);
  }
}

/* ------------------------------------------------------------------ atoms */

export function rect(x: number, y: number, w: number, h: number): string {
  return `M${n(x)} ${n(y)}h${n(q(w))}v${n(q(h))}h${n(-q(w))}Z`;
}

export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): string {
  const rx = q(x);
  const ry = q(y);
  const rw = q(w);
  const rh = q(h);
  const r = q(Math.min(radius, rw / 2, rh / 2));
  if (r <= 0) return rect(rx, ry, rw, rh);
  const runX = q(rw - 2 * r);
  const runY = q(rh - 2 * r);
  return (
    `M${n(rx + r)} ${n(ry)}` +
    `h${n(runX)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}` +
    `v${n(runY)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}` +
    `h${n(-runX)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}` +
    `v${n(-runY)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}Z`
  );
}

export function circle(cx: number, cy: number, r: number): string {
  // Two arcs rather than four: shorter, and exact.
  const rr = q(r);
  return (
    `M${n(q(cx) - rr)} ${n(q(cy))}` +
    `a${n(rr)} ${n(rr)} 0 1 0 ${n(rr * 2)} 0` +
    `a${n(rr)} ${n(rr)} 0 1 0 ${n(-rr * 2)} 0Z`
  );
}

/** A plus sign inscribed in a circle of radius `r`; `thickness` of the width. */
function crossPath(cx: number, cy: number, r: number, thickness: number): string {
  const rr = q(r);
  const t = q(rr * thickness);
  const arm = q(rr - t);
  return (
    `M${n(q(cx) - t)} ${n(q(cy) - rr)}h${n(t * 2)}v${n(arm)}h${n(arm)}` +
    `v${n(t * 2)}h${n(-arm)}v${n(arm)}h${n(-t * 2)}v${n(-arm)}` +
    `h${n(-arm)}v${n(-t * 2)}h${n(arm)}Z`
  );
}

function starPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    // Start at the top, so a five-pointed star points up.
    const angle = (Math.PI * i) / points - Math.PI / 2;
    parts.push(
      `${i === 0 ? "M" : "L"}${n(cx + Math.cos(angle) * radius)} ${n(cy + Math.sin(angle) * radius)}`,
    );
  }
  return `${parts.join("")}Z`;
}

/**
 * A heart inscribed in the cell.
 *
 * Two arcs for the lobes and two curves down to the point. Kept symmetrical
 * about `cx` by construction rather than by eye, because an asymmetric heart
 * at 3mm reads as a smudge.
 */
function heartPath(cx: number, cy: number, r: number): string {
  const top = cy - r * 0.62;
  const lobe = r * 0.52;
  const bottom = cy + r;
  return (
    `M${n(cx)} ${n(bottom)}` +
    `C${n(cx - r)} ${n(cy + r * 0.1)} ${n(cx - r)} ${n(top - lobe * 0.3)} ${n(cx - lobe)} ${n(top)}` +
    `A${n(lobe)} ${n(lobe)} 0 0 1 ${n(cx)} ${n(top + lobe * 0.55)}` +
    `A${n(lobe)} ${n(lobe)} 0 0 1 ${n(cx + lobe)} ${n(top)}` +
    `C${n(cx + r)} ${n(top - lobe * 0.3)} ${n(cx + r)} ${n(cy + r * 0.1)} ${n(cx)} ${n(bottom)}Z`
  );
}

/** A square with the top-left and bottom-right corners rounded away. */
function leafPath(x: number, y: number, w: number, radius: number): string {
  const rx = q(x);
  const ry = q(y);
  const rw = q(w);
  const r = q(Math.min(radius, rw / 2));
  const run = q(rw - r);
  return (
    `M${n(rx + r)} ${n(ry)}` +
    `h${n(run)}v${n(run)}` +
    `a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}` +
    `h${n(-run)}v${n(-run)}` +
    `a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}Z`
  );
}

/**
 * A module that joins up with its neighbours.
 *
 * Each corner is rounded only where BOTH of the sides meeting at it are open.
 * A lone module therefore comes out as a circle-ish blob, a run comes out as a
 * single rounded bar, and a solid area comes out square — which is exactly how
 * a hand-drawn version of this would look, and why it reads as designed rather
 * than as a filter applied to a QR code.
 */
function fluidPath(
  x: number,
  y: number,
  w: number,
  radius: number,
  neighbours: Neighbours,
): string {
  const rx = q(x);
  const ry = q(y);
  const rw = q(w);
  const r = q(Math.min(radius, rw / 2));
  const tl = !neighbours.up && !neighbours.left ? r : 0;
  const tr = !neighbours.up && !neighbours.right ? r : 0;
  const br = !neighbours.down && !neighbours.right ? r : 0;
  const bl = !neighbours.down && !neighbours.left ? r : 0;

  const arc = (rr: number, dx: number, dy: number): string =>
    rr > 0 ? `a${n(rr)} ${n(rr)} 0 0 1 ${n(dx)} ${n(dy)}` : "";

  return (
    `M${n(rx + tl)} ${n(ry)}` +
    `h${n(q(rw - tl - tr))}${arc(tr, tr, tr)}` +
    `v${n(q(rw - tr - br))}${arc(br, -br, br)}` +
    `h${n(-q(rw - br - bl))}${arc(bl, -bl, -bl)}` +
    `v${n(-q(rw - bl - tl))}${arc(tl, tl, -tl)}Z`
  );
}

/**
 * A stable pseudo-random number in [0, 1) from a cell and a seed.
 *
 * Deterministic and position-based rather than sequential, so adding a module
 * does not reshuffle every module after it — the mosaic has to look the same
 * after a one-character edit to the payload, or the preview flickers into
 * something else on every keystroke.
 */
export function hash01(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ============================================================
 * The eyes
 *
 * A finder pattern is a 7×7: a dark ring 1 module thick, a light ring inside
 * it, and a 3×3 dark centre. Both rings are drawn as one path with a hole in
 * it, using the even-odd fill rule, so the light ring is genuinely a hole and
 * shows whatever is behind the code. Drawing it as two filled shapes instead
 * would paint the middle ring with the background colour, which is wrong the
 * moment the background is a photograph.
 * ========================================================== */

/** The outer ring of an eye, as a filled outline with a hole in it. */
export function eyeFramePath(frame: EyeFrame, x: number, y: number): string {
  const outer = 7;
  const inner = 5;
  const ix = x + 1;
  const iy = y + 1;

  switch (frame) {
    case "square":
      return rect(x, y, outer, outer) + rect(ix, iy, inner, inner);

    case "rounded":
      return (
        roundedRect(x, y, outer, outer, 1.75) + roundedRect(ix, iy, inner, inner, 1.1)
      );

    case "circle":
      return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5);

    case "cushion":
      // Heavily rounded but not round: the corners read as a cushion.
      return (
        roundedRect(x, y, outer, outer, 2.6) + roundedRect(ix, iy, inner, inner, 1.8)
      );

    case "leaf":
      return leafPath(x, y, outer, 3.5) + leafPath(ix, iy, inner, 2.5);

    case "flower":
      // All four corners rounded to the full radius makes a quatrefoil.
      return (
        roundedRect(x, y, outer, outer, 3.5) + roundedRect(ix, iy, inner, inner, 2.5)
      );

    case "beveled":
      return bevelled(x, y, outer, 1.6) + bevelled(ix, iy, inner, 1.1);

    case "dotted":
      /*
       * The ring as sixteen separate dots — one per module of the real ring,
       * which is what keeps it locatable. A continuous ring made of dots that
       * did not line up with the module grid would move the pattern's edges
       * and is the one eye style that genuinely stops a code scanning.
       */
      return ringOfDots(x, y, outer);
  }
}

/** A square with its corners cut off at 45°. */
function bevelled(x: number, y: number, w: number, cut: number): string {
  const rw = q(w);
  const c = q(Math.min(cut, rw / 2));
  const run = q(rw - 2 * c);
  return (
    `M${n(q(x) + c)} ${n(q(y))}h${n(run)}l${n(c)} ${n(c)}` +
    `v${n(run)}l${n(-c)} ${n(c)}h${n(-run)}l${n(-c)} ${n(-c)}` +
    `v${n(-run)}Z`
  );
}

/** Sixteen dots on the 7×7 ring, each centred on its own module. */
function ringOfDots(x: number, y: number, w: number): string {
  let d = "";
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < w; j++) {
      const onRing = i === 0 || j === 0 || i === w - 1 || j === w - 1;
      if (onRing) d += circle(x + i + 0.5, y + j + 0.5, 0.45);
    }
  }
  return d;
}

/** The 3×3 centre of an eye. */
export function eyeBallPath(ball: EyeBall, x: number, y: number): string {
  const bx = x + 2;
  const by = y + 2;
  const cx = x + 3.5;
  const cy = y + 3.5;

  switch (ball) {
    case "square":
      return rect(bx, by, 3, 3);
    case "rounded":
      return roundedRect(bx, by, 3, 3, 0.85);
    case "circle":
      return circle(cx, cy, 1.5);
    case "diamond":
      return `M${n(cx)} ${n(cy - 1.5)}L${n(cx + 1.5)} ${n(cy)}L${n(cx)} ${n(cy + 1.5)}L${n(cx - 1.5)} ${n(cy)}Z`;
    case "star":
      return starPath(cx, cy, 1.5, 0.68, 5);
    case "cross":
      return crossPath(cx, cy, 1.5, 0.4);
    case "leaf":
      return leafPath(bx, by, 3, 1.5);
    case "flower":
      return roundedRect(bx, by, 3, 3, 1.5);
  }
}

/* ============================================================
 * Centre icons
 *
 * Drawn in a 0–24 box and scaled by the renderer. Deliberately simple: an
 * icon in the middle of a QR code is about 12 modules across on a printed
 * flyer, and detail at that size becomes a grey patch.
 * ========================================================== */

export const ICON_PATHS: Record<string, string> = {
  cross: "M10 2h4v6h6v4h-6v10h-4V12H4V8h6V2Z",
  dove:
    "M3 13c3 0 5-1 7-3 1.5-1.5 3-3.5 6-3.5 2.5 0 4 1.5 4 3.5 0 1-.4 1.8-1 2.4 " +
    "1 .3 1.6 1 1.6 2.1 0 2.5-2.6 4.5-6.6 4.5-5 0-9-2.3-11-6Z",
  book:
    "M12 5c-2.2-1.3-4.6-2-7-2-.6 0-1 .4-1 1v12c0 .6.4 1 1 1 2.4 0 4.8.7 7 2 " +
    "2.2-1.3 4.6-2 7-2 .6 0 1-.4 1-1V4c0-.6-.4-1-1-1-2.4 0-4.8.7-7 2Zm0 0v14",
  heart:
    "M12 21C7 17.5 3 14.6 3 10.6 3 7.5 5.4 5 8.4 5c1.5 0 2.8.6 3.6 1.7C12.8 5.6 " +
    "14.1 5 15.6 5 18.6 5 21 7.5 21 10.6c0 4-4 6.9-9 10.4Z",
  church: "M11 2h2v3h3v3h-3v2.3l7 4.2V22h-6v-6h-4v6H4v-7.5l7-4.2V8H8V5h3V2Z",
  flame:
    "M12 2c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2.5-5 .3 1.4 1 2.3 2 2.6C10 7.5 " +
    "10.6 4.6 12 2Z",
  hands:
    "M9 21V9a2 2 0 0 1 4 0v3M9 21h8a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-4M9 21H6a2 2 " +
    "0 0 1-2-2v-6l3-3",
  fish: "M2 12c4-5 9-7 13-7 3 0 5 1.5 7 4l-3 3 3 3c-2 2.5-4 4-7 4-4 0-9-2-13-7Z",
};

/** Icons whose shape is a stroke rather than a filled area. */
export const ICON_STROKED = new Set(["hands", "book"]);
