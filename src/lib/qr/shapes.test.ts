import { describe, expect, it } from "vitest";
import {
  EYE_BALLS,
  EYE_FRAMES,
  MODULE_SHAPES,
  type ModuleShape,
} from "@/lib/qr/design";
import {
  circle,
  eyeBallPath,
  eyeFramePath,
  hash01,
  modulePath,
  rect,
  roundedRect,
} from "@/lib/qr/shapes";
import { pathBounds } from "@/lib/qr/path-bounds";

/**
 * Every shape stays in its own cell.
 *
 * This is the only property of a decorative module shape that affects whether
 * the code works. A shape that overflows its cell by a tenth of a module looks
 * fine in a preview and merges with its neighbour on paper, turning two
 * modules into one — and a scanner reading one module where there were two
 * does not report an error, it reports different data or nothing at all.
 *
 * So the bound is asserted rather than eyeballed, for every shape at every
 * scale, using a real path-bounds implementation (arcs converted to centre
 * form, Bézier curves bounded by their control hull) rather than a regex over
 * the coordinates.
 */

const EPSILON = 1e-6;

describe("the path-bounds helper itself", () => {
  // Tested first, because every assertion below depends on it being right.
  it("bounds a rectangle", () => {
    expect(pathBounds(rect(2, 3, 4, 5))).toEqual({
      minX: 2,
      minY: 3,
      maxX: 6,
      maxY: 8,
    });
  });

  it("bounds a circle through its arcs, not just its endpoints", () => {
    // The endpoints are only (0,5) and (10,5); the arcs reach y=0 and y=10.
    const b = pathBounds(circle(5, 5, 5));
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(10, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(10, 6);
  });

  it("does not let a rounded rectangle's corner arcs escape the rectangle", () => {
    // The naive "expand by the radius around each endpoint" approach reports
    // this as 1 unit too big on every side.
    const b = pathBounds(roundedRect(0, 0, 10, 10, 2.5));
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(10, 6);
    expect(b.maxY).toBeCloseTo(10, 6);
  });

  it("follows relative commands and h/v shorthands", () => {
    expect(pathBounds("M1 1h3v2h-3Z")).toEqual({
      minX: 1,
      minY: 1,
      maxX: 4,
      maxY: 3,
    });
  });
});

describe("module shapes", () => {
  const scales = [0.55, 0.7, 0.85, 1];

  it("never leaves its own cell, at any scale, anywhere in the grid", () => {
    for (const shape of MODULE_SHAPES) {
      for (const scale of scales) {
        for (const [x, y] of [
          [0, 0],
          [3, 7],
          [40, 40],
        ]) {
          // Every combination of neighbours, since `fluid` uses them to decide
          // which corners to round and could round one outward.
          for (let mask = 0; mask < 16; mask++) {
            const d = modulePath(shape, x, y, scale, {
              up: (mask & 1) !== 0,
              down: (mask & 2) !== 0,
              left: (mask & 4) !== 0,
              right: (mask & 8) !== 0,
            });
            const b = pathBounds(d);
            const where = `${shape} at (${x},${y}) scale ${scale} neighbours ${mask}`;
            expect(b.minX, `${where} left`).toBeGreaterThanOrEqual(x - EPSILON);
            expect(b.minY, `${where} top`).toBeGreaterThanOrEqual(y - EPSILON);
            expect(b.maxX, `${where} right`).toBeLessThanOrEqual(x + 1 + EPSILON);
            expect(b.maxY, `${where} bottom`).toBeLessThanOrEqual(y + 1 + EPSILON);
          }
        }
      }
    }
  });

  it("covers the middle of its cell, which is where a scanner looks", () => {
    // A shape that misses the centre is not a decorative choice, it is a
    // module read as light. Checked by the bounding box straddling the centre
    // in both directions — the weakest useful form of this, and enough to
    // catch a shape built around the wrong origin.
    for (const shape of MODULE_SHAPES) {
      const b = pathBounds(modulePath(shape, 5, 9, 1));
      expect(b.minX, shape).toBeLessThan(5.5);
      expect(b.maxX, shape).toBeGreaterThan(5.5);
      expect(b.minY, shape).toBeLessThan(9.5);
      expect(b.maxY, shape).toBeGreaterThan(9.5);
    }
  });

  it("fills most of the cell at full scale for the solid shapes", () => {
    const solid: ModuleShape[] = ["square", "rounded", "squircle", "fluid"];
    for (const shape of solid) {
      const b = pathBounds(modulePath(shape, 0, 0, 1));
      expect(b.maxX - b.minX, shape).toBeCloseTo(1, 3);
      expect(b.maxY - b.minY, shape).toBeCloseTo(1, 3);
    }
  });

  it("produces something for every shape, with none silently empty", () => {
    for (const shape of MODULE_SHAPES) {
      const d = modulePath(shape, 0, 0, 1);
      expect(d.length, shape).toBeGreaterThan(8);
      expect(d, shape).toMatch(/^M/);
      // An empty path renders nothing and would read as a missing module.
      const b = pathBounds(d);
      expect((b.maxX - b.minX) * (b.maxY - b.minY), shape).toBeGreaterThan(0.1);
    }
  });

  it("shrinks towards the centre rather than towards a corner", () => {
    const full = pathBounds(modulePath("square", 10, 10, 1));
    const small = pathBounds(modulePath("square", 10, 10, 0.6));
    expect((small.minX + small.maxX) / 2).toBeCloseTo((full.minX + full.maxX) / 2, 6);
    expect((small.minY + small.maxY) / 2).toBeCloseTo((full.minY + full.maxY) / 2, 6);
  });

  describe("fluid", () => {
    it("rounds a corner only where both of its sides are open", () => {
      // Hemmed in on all four sides, it must be a plain square — otherwise a
      // solid block of modules would be full of little notches.
      const enclosed = modulePath("fluid", 0, 0, 1, {
        up: true,
        down: true,
        left: true,
        right: true,
      });
      expect(enclosed).not.toContain("a");

      // Alone, every corner rounds.
      const alone = modulePath("fluid", 0, 0, 1, {
        up: false,
        down: false,
        left: false,
        right: false,
      });
      expect(alone.match(/a/g)).toHaveLength(4);

      // Part of a horizontal run: the two corners facing the neighbour stay
      // square, so the run reads as one continuous bar.
      const middleOfRun = modulePath("fluid", 0, 0, 1, {
        up: false,
        down: false,
        left: true,
        right: true,
      });
      expect(middleOfRun).not.toContain("a");
    });
  });

  describe("mosaic", () => {
    it("is stable: the same cell and seed always give the same size", () => {
      // A preview that reshuffles on every keystroke is unusable, and a
      // download that differs from the preview is worse.
      const a = modulePath("mosaic", 4, 9, 1, undefined, 42);
      const b = modulePath("mosaic", 4, 9, 1, undefined, 42);
      expect(a).toBe(b);
    });

    it("varies between cells, and between seeds", () => {
      const here = modulePath("mosaic", 4, 9, 1, undefined, 42);
      const there = modulePath("mosaic", 5, 9, 1, undefined, 42);
      const other = modulePath("mosaic", 4, 9, 1, undefined, 43);
      expect(here).not.toBe(there);
      expect(here).not.toBe(other);
    });

    it("is position-based, so one more module does not reshuffle the rest", () => {
      // The reason hash01 takes coordinates rather than a running counter.
      expect(hash01(7, 7, 1)).toBe(hash01(7, 7, 1));
      expect(hash01(7, 7, 1)).not.toBe(hash01(8, 7, 1));
    });

    it("spreads over the unit interval rather than clustering", () => {
      const values: number[] = [];
      for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) values.push(hash01(x, y, 7));
      expect(Math.min(...values)).toBeLessThan(0.05);
      expect(Math.max(...values)).toBeGreaterThan(0.95);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean).toBeGreaterThan(0.45);
      expect(mean).toBeLessThan(0.55);
    });
  });
});

describe("eye frames", () => {
  it("stay inside the 7×7 the finder pattern occupies", () => {
    for (const frame of EYE_FRAMES) {
      for (const [x, y] of [
        [0, 0],
        [30, 0],
        [0, 30],
      ]) {
        const b = pathBounds(eyeFramePath(frame, x, y));
        expect(b.minX, frame).toBeGreaterThanOrEqual(x - EPSILON);
        expect(b.minY, frame).toBeGreaterThanOrEqual(y - EPSILON);
        expect(b.maxX, frame).toBeLessThanOrEqual(x + 7 + EPSILON);
        expect(b.maxY, frame).toBeLessThanOrEqual(y + 7 + EPSILON);
      }
    }
  });

  it("is a ring: two subpaths, so even-odd leaves a genuine hole", () => {
    for (const frame of EYE_FRAMES) {
      const d = eyeFramePath(frame, 0, 0);
      const subpaths = (d.match(/M/g) ?? []).length;
      // Dotted is sixteen dots; every other style is an outer and an inner
      // outline. Either way, more than one — a single outline would fill the
      // middle solid and destroy the pattern.
      expect(subpaths, frame).toBeGreaterThan(1);
    }
  });

  it("reaches the outer edge, which is what a scanner locates", () => {
    for (const frame of EYE_FRAMES) {
      const b = pathBounds(eyeFramePath(frame, 0, 0));
      // Within half a module of the full 7, so a circle (which touches the
      // edge only at four points) and the dots (centred in their modules)
      // both pass, and a frame drawn at 5×7 does not.
      expect(b.maxX - b.minX, frame).toBeGreaterThan(6);
      expect(b.maxY - b.minY, frame).toBeGreaterThan(6);
    }
  });
});

describe("eye balls", () => {
  it("stay inside the 3×3 at the middle of the eye", () => {
    for (const ball of EYE_BALLS) {
      const b = pathBounds(eyeBallPath(ball, 10, 20));
      expect(b.minX, ball).toBeGreaterThanOrEqual(12 - EPSILON);
      expect(b.minY, ball).toBeGreaterThanOrEqual(22 - EPSILON);
      expect(b.maxX, ball).toBeLessThanOrEqual(15 + EPSILON);
      expect(b.maxY, ball).toBeLessThanOrEqual(25 + EPSILON);
    }
  });

  it("is centred on the eye's middle", () => {
    /*
     * A quarter of a module of tolerance, because two of these shapes are
     * legitimately off-centre by silhouette: a five-pointed star has one
     * vertex at the top and two part-way up the bottom, so its bounding box
     * sits higher than the circle it is inscribed in. What matters is that the
     * ink is over the middle of the 3x3, not that the box is symmetrical.
     */
    for (const ball of EYE_BALLS) {
      const b = pathBounds(eyeBallPath(ball, 0, 0));
      expect(Math.abs((b.minX + b.maxX) / 2 - 3.5), ball).toBeLessThan(0.25);
      expect(Math.abs((b.minY + b.maxY) / 2 - 3.5), ball).toBeLessThan(0.25);
      // And it genuinely spans the middle in both directions.
      expect(b.minX, ball).toBeLessThan(3.5);
      expect(b.maxX, ball).toBeGreaterThan(3.5);
      expect(b.minY, ball).toBeLessThan(3.5);
      expect(b.maxY, ball).toBeGreaterThan(3.5);
    }
  });
});
