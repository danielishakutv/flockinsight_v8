/**
 * The exact bounding box of an SVG path.
 *
 * Written for `shapes.test.ts`, which asserts that every decorative module
 * shape stays inside its own cell. That assertion is the difference between a
 * shape that looks nice and a shape that merges with the module next to it and
 * turns two modules into one — a failure that is invisible in a preview and
 * fatal on paper.
 *
 * A bounding box is only an upper bound if the curves are handled properly:
 *
 *   - For a cubic Bézier, the curve lies inside the convex hull of its four
 *     control points, so including the control points is conservative and
 *     correct (it may over-report, never under-report).
 *   - For an arc, the control points are not available at all, so the endpoint
 *     parameterisation is converted to a centre, and the axis extremes of the
 *     ellipse are included only where they fall inside the arc's sweep.
 *     Expanding by the radius around the endpoints instead would be
 *     conservative but useless — it reports every rounded rectangle as
 *     overflowing its own box.
 *
 * Kept out of the test file so it can be tested itself, against shapes whose
 * bounds are known by hand.
 */

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const EMPTY: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

/** Every command in a path, as a letter and its numbers. */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const args = (match[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    out.push({ cmd: match[1], args });
  }
  return out;
}

export function pathBounds(d: string): Bounds {
  let bounds = { ...EMPTY };
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const include = (px: number, py: number): void => {
    bounds.minX = Math.min(bounds.minX, px);
    bounds.minY = Math.min(bounds.minY, py);
    bounds.maxX = Math.max(bounds.maxX, px);
    bounds.maxY = Math.max(bounds.maxY, py);
  };

  for (const { cmd, args } of tokenize(d)) {
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === "Z") {
      x = startX;
      y = startY;
      continue;
    }

    // Commands take a fixed number of arguments and may repeat.
    const arity =
      upper === "M" || upper === "L" || upper === "T"
        ? 2
        : upper === "H" || upper === "V"
          ? 1
          : upper === "C"
            ? 6
            : upper === "S" || upper === "Q"
              ? 4
              : 7; // A

    for (let i = 0; i + arity <= args.length; i += arity) {
      const a = args.slice(i, i + arity);
      switch (upper) {
        case "M": {
          x = rel ? x + a[0] : a[0];
          y = rel ? y + a[1] : a[1];
          // Only the first pair of an M starts a subpath; the rest are lines.
          if (i === 0) {
            startX = x;
            startY = y;
          }
          include(x, y);
          break;
        }
        case "L": {
          x = rel ? x + a[0] : a[0];
          y = rel ? y + a[1] : a[1];
          include(x, y);
          break;
        }
        case "H": {
          x = rel ? x + a[0] : a[0];
          include(x, y);
          break;
        }
        case "V": {
          y = rel ? y + a[0] : a[0];
          include(x, y);
          break;
        }
        case "C": {
          // The convex hull of the control points bounds the curve.
          const c1x = rel ? x + a[0] : a[0];
          const c1y = rel ? y + a[1] : a[1];
          const c2x = rel ? x + a[2] : a[2];
          const c2y = rel ? y + a[3] : a[3];
          const ex = rel ? x + a[4] : a[4];
          const ey = rel ? y + a[5] : a[5];
          include(c1x, c1y);
          include(c2x, c2y);
          include(ex, ey);
          x = ex;
          y = ey;
          break;
        }
        case "S":
        case "Q": {
          const cx = rel ? x + a[0] : a[0];
          const cy = rel ? y + a[1] : a[1];
          const ex = rel ? x + a[2] : a[2];
          const ey = rel ? y + a[3] : a[3];
          include(cx, cy);
          include(ex, ey);
          x = ex;
          y = ey;
          break;
        }
        case "T": {
          x = rel ? x + a[0] : a[0];
          y = rel ? y + a[1] : a[1];
          include(x, y);
          break;
        }
        case "A": {
          const [rx, ry, rotation, largeArc, sweep] = a;
          const ex = rel ? x + a[5] : a[5];
          const ey = rel ? y + a[6] : a[6];
          include(ex, ey);
          for (const p of arcExtremes(
            x,
            y,
            ex,
            ey,
            Math.abs(rx),
            Math.abs(ry),
            rotation,
            largeArc !== 0,
            sweep !== 0,
          )) {
            include(p[0], p[1]);
          }
          x = ex;
          y = ey;
          break;
        }
      }
    }
  }

  if (bounds.minX === Infinity) bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bounds;
}

/**
 * The axis extremes of an elliptical arc that actually lie on it.
 *
 * The endpoint-to-centre conversion from the SVG specification, then the four
 * axis points of the ellipse, kept only where the arc's sweep passes through
 * them. Rotation is handled for completeness; every arc this module produces
 * has none.
 */
function arcExtremes(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
): [number, number][] {
  if (rx === 0 || ry === 0) return [];
  if (x1 === x2 && y1 === y2) return [];

  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  // Scale the radii up if they are too small to join the two endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  let rxs = rx;
  let rys = ry;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxs = rx * s;
    rys = ry * s;
  }

  const num =
    rxs * rxs * rys * rys - rxs * rxs * y1p * y1p - rys * rys * x1p * x1p;
  const den = rxs * rxs * y1p * y1p + rys * rys * x1p * x1p;
  const factor = Math.sqrt(Math.max(0, num / den)) * (largeArc !== sweep ? 1 : -1);

  const cxp = (factor * (rxs * y1p)) / rys;
  const cyp = (factor * -(rys * x1p)) / rxs;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const theta1 = Math.atan2((y1p - cyp) / rys, (x1p - cxp) / rxs);
  const theta2 = Math.atan2((-y1p - cyp) / rys, (-x1p - cxp) / rxs);
  let delta = theta2 - theta1;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const onArc = (angle: number): boolean => {
    // Normalise the offset from theta1 into the sweep's own direction.
    let t = angle - theta1;
    while (t < 0) t += 2 * Math.PI;
    while (t >= 2 * Math.PI) t -= 2 * Math.PI;
    return delta >= 0 ? t <= delta + 1e-9 : t - 2 * Math.PI >= delta - 1e-9;
  };

  const out: [number, number][] = [];
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (!onArc(angle)) continue;
    const ex = cx + rxs * Math.cos(angle) * cos - rys * Math.sin(angle) * sin;
    const ey = cy + rxs * Math.cos(angle) * sin + rys * Math.sin(angle) * cos;
    out.push([ex, ey]);
  }
  return out;
}
