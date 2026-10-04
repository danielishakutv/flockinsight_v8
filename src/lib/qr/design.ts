/**
 * What a QR code LOOKS like — every knob, and what a stored one means.
 *
 * Pure and client-safe: the designer re-derives the whole picture from this
 * object on every keystroke, so nothing here may touch a database, a window or
 * a clock.
 *
 * THE SHAPE OF THE PROBLEM. A QR code is a grid of modules, and a scanner
 * needs four things from it: three finder eyes it can locate, a quiet border,
 * enough contrast to tell dark from light, and no more damage than the error
 * correction can repair. Everything else — what shape a module is, what colour
 * it is, whether it is filled with a photograph of last Sunday, what sits in
 * the middle — is free. This file is the inventory of what is free, and
 * `verify.ts` is what checks the four things that are not.
 *
 * WHY THERE ARE SO MANY KNOBS. A church with no designer is choosing from
 * `PRESETS` at the bottom of this file, not from the knobs. The knobs exist so
 * the presets can be genuinely different from each other rather than the same
 * code in seven colours, and so the one church that wants its own look can
 * have it. Every knob has a default, and every default is safe.
 *
 * `normaliseDesign` is the only definition of a valid design, used both when a
 * row comes out of the database and when one arrives from a form. A Zod mirror
 * of this would be a second definition, and the second definition is the one
 * that drifts.
 */

import type { EcLevel } from "@/lib/qr/tables";
import { EC_LEVELS } from "@/lib/qr/tables";

/* ============================================================
 * Module shapes
 * ========================================================== */

export const MODULE_SHAPES = [
  "square",
  "rounded",
  "dot",
  "squircle",
  "diamond",
  "star",
  "cross",
  "heart",
  "leaf",
  "bar-v",
  "bar-h",
  "fluid",
  "mosaic",
  "letters",
] as const;

export type ModuleShape = (typeof MODULE_SHAPES)[number];

export const MODULE_SHAPE_LABEL: Record<ModuleShape, string> = {
  square: "Square",
  rounded: "Rounded",
  dot: "Dots",
  squircle: "Soft square",
  diamond: "Diamonds",
  star: "Stars",
  cross: "Crosses",
  heart: "Hearts",
  leaf: "Leaves",
  "bar-v": "Vertical bars",
  "bar-h": "Horizontal bars",
  fluid: "Fluid",
  mosaic: "Mosaic",
  letters: "Letters",
};

/**
 * Shapes that leave a lot of white between modules.
 *
 * Not a style note — a practical one. A scanner thresholds the image and then
 * decides a module is dark if its CENTRE is dark, so a shape that fills little
 * of its cell is read correctly by a good camera and missed by a cheap one in
 * poor light. `verify.ts` warns when one of these is combined with anything
 * else that is already costing margin.
 */
export const SPARSE_SHAPES: ModuleShape[] = [
  "dot",
  "diamond",
  "star",
  "cross",
  "heart",
  "leaf",
  "letters",
];

export const EYE_FRAMES = [
  "square",
  "rounded",
  "circle",
  "cushion",
  "leaf",
  "flower",
  "beveled",
  "dotted",
] as const;
export type EyeFrame = (typeof EYE_FRAMES)[number];

export const EYE_FRAME_LABEL: Record<EyeFrame, string> = {
  square: "Square",
  rounded: "Rounded",
  circle: "Circle",
  cushion: "Cushion",
  leaf: "Leaf",
  flower: "Flower",
  beveled: "Bevelled",
  dotted: "Dotted",
};

export const EYE_BALLS = [
  "square",
  "rounded",
  "circle",
  "diamond",
  "star",
  "cross",
  "leaf",
  "flower",
] as const;
export type EyeBall = (typeof EYE_BALLS)[number];

export const EYE_BALL_LABEL: Record<EyeBall, string> = {
  square: "Square",
  rounded: "Rounded",
  circle: "Circle",
  diamond: "Diamond",
  star: "Star",
  cross: "Cross",
  leaf: "Leaf",
  flower: "Flower",
};

/* ============================================================
 * Fills
 * ========================================================== */

export type QrFill =
  | { type: "solid"; color: string }
  | { type: "linear"; from: string; to: string; angle: number }
  | { type: "radial"; from: string; to: string }
  /** The modules become windows onto a photograph. */
  | { type: "image"; url: string }
  /** Concentric bands of colour, out from the middle. */
  | { type: "rings"; colors: string[] };

export type QrBackground =
  | { type: "transparent" }
  | { type: "solid"; color: string }
  | { type: "linear"; from: string; to: string; angle: number }
  /**
   * A photograph behind the code, with a veil over it.
   *
   * `scrim` is the opacity of a flat wash of `scrimColor` laid between the
   * photograph and the modules. Without it a code over a photograph is
   * unreadable wherever the photograph happens to be dark, and that is not a
   * thing a preview on a bright laptop makes obvious.
   */
  | { type: "image"; url: string; scrim: number; scrimColor: string };

/* ============================================================
 * The middle
 * ========================================================== */

export const CENTRE_ICONS = [
  "cross",
  "dove",
  "book",
  "heart",
  "church",
  "flame",
  "hands",
  "fish",
] as const;
export type CentreIcon = (typeof CENTRE_ICONS)[number];

export const CENTRE_ICON_LABEL: Record<CentreIcon, string> = {
  cross: "Cross",
  dove: "Dove",
  book: "Open book",
  heart: "Heart",
  church: "Church",
  flame: "Flame",
  hands: "Praying hands",
  fish: "Fish",
};

export const CENTRE_SHAPES = ["square", "rounded", "circle"] as const;
export type CentreShape = (typeof CENTRE_SHAPES)[number];

export type QrCentre =
  | { type: "none" }
  | {
      type: "image";
      url: string;
      /** Width as a fraction of the symbol, 0.10–0.30. */
      size: number;
      shape: CentreShape;
      /** A plate behind it, so the logo is not read as modules. */
      backdrop: boolean;
      backdropColor: string;
    }
  | {
      type: "monogram";
      text: string;
      size: number;
      shape: CentreShape;
      color: string;
      backdropColor: string;
    }
  | {
      type: "icon";
      icon: CentreIcon;
      size: number;
      shape: CentreShape;
      color: string;
      backdropColor: string;
    };

/* ============================================================
 * The frame around it
 * ========================================================== */

export const FRAME_STYLES = ["none", "bar", "ribbon", "card", "ticket", "badge"] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];

export const FRAME_STYLE_LABEL: Record<FrameStyle, string> = {
  none: "No frame",
  bar: "Caption bar",
  ribbon: "Ribbon",
  card: "Card",
  ticket: "Ticket",
  badge: "Badge",
};

export type QrFrame = {
  style: FrameStyle;
  text: string;
  position: "bottom" | "top";
  color: string;
  textColor: string;
};

/* ============================================================
 * The design
 * ========================================================== */

export type QrDesign = {
  module: ModuleShape;
  /**
   * How much of its cell a module fills, 0.55–1.
   *
   * Under 1 every module shrinks towards its own centre, which is what makes
   * dotted and mosaic looks possible. It is the single fastest way to make a
   * code unscannable, so `verify.ts` treats it as spent margin.
   */
  moduleScale: number;
  /** Seeds `mosaic`, so the same design redraws identically every time. */
  seed: number;
  /** Letters cycled through the modules when `module` is "letters". */
  letters: string;
  eyeFrame: EyeFrame;
  eyeBall: EyeBall;
  fill: QrFill;
  /** Null = the eyes take the module fill. */
  eyeFrameColor: string | null;
  eyeBallColor: string | null;
  background: QrBackground;
  centre: QrCentre;
  frame: QrFrame;
  /** Quiet zone, in modules. Four is the standard's figure. */
  margin: number;
  /** Rounded corners on the whole image, in modules. */
  cornerRadius: number;
  ecLevel: EcLevel;
  /**
   * A floor on the version, so a short payload can still be given a dense
   * grid. A 21-module code next to a 7-module logo looks like a mistake.
   */
  minVersion: number;
};

export const DEFAULT_DESIGN: QrDesign = {
  module: "rounded",
  moduleScale: 1,
  seed: 1,
  letters: "",
  eyeFrame: "rounded",
  eyeBall: "rounded",
  fill: { type: "solid", color: "#11182a" },
  eyeFrameColor: null,
  eyeBallColor: null,
  background: { type: "solid", color: "#ffffff" },
  centre: { type: "none" },
  /*
   * No caption text by default. `SCAN ME` used to live here, which made the
   * default design and a normalised empty one differ by a string nobody could
   * see (the style is "none", so it is never drawn). The designer suggests the
   * words when a frame style is first chosen, which is where the suggestion
   * belongs.
   */
  frame: { style: "none", text: "", position: "bottom", color: "#11182a", textColor: "#ffffff" },
  margin: 4,
  cornerRadius: 0,
  ecLevel: "M",
  minVersion: 1,
};

/* ============================================================
 * Colour
 *
 * Hex only. A colour input produces hex, a stored design holds hex, and the
 * contrast maths in verify.ts needs channels rather than a string a browser
 * happens to understand — `rebeccapurple` would have to be looked up in a
 * table, and `hsl()` parsed, for no gain to anybody.
 * ========================================================== */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value.trim());
}

/** A hex colour's channels, 0–255. Invalid input reads as black, never throws. */
export function hexChannels(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const [r, g, b] = hexChannels(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio, 1 (identical) to 21 (black on white).
 *
 * Borrowed from accessibility because it is the same question: can a sensor
 * with a limited dynamic range tell these two apart. A scanner is less fussy
 * than a human eye about hue and far fussier about being in a dim foyer with
 * a phone from 2019.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every colour a fill can paint a module, for the contrast check. */
export function fillColors(fill: QrFill): string[] {
  switch (fill.type) {
    case "solid":
      return [fill.color];
    case "linear":
    case "radial":
      return [fill.from, fill.to];
    case "rings":
      return fill.colors.length ? fill.colors : ["#11182a"];
    case "image":
      // Unknowable from here: it depends on the photograph. The rendered-image
      // check in verify.ts is the only honest answer, and says so.
      return [];
  }
}

/**
 * The effective colour behind the modules.
 *
 * For a photograph this is the scrim, which is the whole reason the scrim
 * exists: it is the one part of an image background whose brightness is known
 * in advance. At a scrim of 1 it is exactly that colour; below 1 the
 * photograph shows through and the contrast check says so rather than
 * pretending.
 */
export function backgroundColors(background: QrBackground): string[] {
  switch (background.type) {
    case "transparent":
      // Printed on paper, shown on a white card: white is the safe assumption,
      // and a dark page behind a transparent code is a real failure mode the
      // verifier warns about separately.
      return ["#ffffff"];
    case "solid":
      return [background.color];
    case "linear":
      return [background.from, background.to];
    case "image":
      return background.scrim >= 0.85 ? [background.scrimColor] : [];
  }
}

/* ============================================================
 * Normalising
 * ========================================================== */

function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function color(value: unknown, fallback: string): string {
  return isHexColor(value) ? value.trim().toLowerCase() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * An image URL, or nothing.
 *
 * ONLY http, https, and a path on this site. The rendered SVG is inserted into
 * the page as markup, so this is the one field in a design that is free text
 * reaching an attribute — and a design arrives from a jsonb column and from a
 * server action, not only from the designer's own file picker.
 *
 * `render.ts` already XML-escapes it, which closes the attribute-breakout
 * route on its own; an SVG `<image>` also does not execute scripts in any
 * browser, so `javascript:` there is inert. Both of those are true today and
 * neither is a thing to depend on. Validating the scheme here means the
 * question does not arise, and it has a second benefit: a `data:` URL holding
 * a whole photograph would otherwise be stored in the row, in every backup,
 * and sent to the browser on every page that lists the code.
 */
function imageUrl(value: unknown, max = 1000): string {
  const raw = str(value, max).trim();
  if (!raw) return "";
  // A path on this site: a church logo served from /uploads, or a public asset.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    const scheme = url.protocol.toLowerCase();
    return scheme === "http:" || scheme === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normaliseFill(raw: unknown): QrFill {
  const o = (raw ?? {}) as Record<string, unknown>;
  switch (o.type) {
    case "linear":
      return {
        type: "linear",
        from: color(o.from, "#11182a"),
        to: color(o.to, "#5b3df5"),
        angle: clamp(o.angle, 0, 360, 45),
      };
    case "radial":
      return {
        type: "radial",
        from: color(o.from, "#5b3df5"),
        to: color(o.to, "#11182a"),
      };
    case "image":
      return { type: "image", url: imageUrl(o.url) };
    case "rings": {
      const colors = Array.isArray(o.colors)
        ? o.colors.filter(isHexColor).slice(0, 6).map((c) => c.trim().toLowerCase())
        : [];
      return { type: "rings", colors: colors.length ? colors : ["#5b3df5", "#0ea5e9", "#11182a"] };
    }
    default:
      return { type: "solid", color: color((o as { color?: unknown }).color, "#11182a") };
  }
}

function normaliseBackground(raw: unknown): QrBackground {
  const o = (raw ?? {}) as Record<string, unknown>;
  switch (o.type) {
    case "transparent":
      return { type: "transparent" };
    case "linear":
      return {
        type: "linear",
        from: color(o.from, "#ffffff"),
        to: color(o.to, "#eef2ff"),
        angle: clamp(o.angle, 0, 360, 45),
      };
    case "image":
      return {
        type: "image",
        url: imageUrl(o.url),
        /*
         * Never below 0.35. A photograph with no veil at all makes a code that
         * cannot be read anywhere the photograph is dark, and the person who
         * built it sees a beautiful preview on a bright screen. The floor is
         * the one knob here that refuses to go where it is pushed.
         */
        scrim: clamp(o.scrim, 0.35, 1, 0.75),
        scrimColor: color(o.scrimColor, "#ffffff"),
      };
    default:
      return { type: "solid", color: color((o as { color?: unknown }).color, "#ffffff") };
  }
}

function normaliseCentre(raw: unknown): QrCentre {
  const o = (raw ?? {}) as Record<string, unknown>;
  const shape = oneOf(o.shape, CENTRE_SHAPES, "rounded");
  // The ceiling is 0.30 of the width, which is ~9% of the area. See the logo
  // budget in verify.ts for why that is the outer limit rather than a taste.
  const size = clamp(o.size, 0.1, 0.3, 0.2);
  switch (o.type) {
    case "image":
      return {
        type: "image",
        url: imageUrl(o.url),
        size,
        shape,
        backdrop: o.backdrop !== false,
        backdropColor: color(o.backdropColor, "#ffffff"),
      };
    case "monogram":
      return {
        type: "monogram",
        text: str(o.text, 4).trim(),
        size,
        shape,
        color: color(o.color, "#ffffff"),
        backdropColor: color(o.backdropColor, "#11182a"),
      };
    case "icon":
      return {
        type: "icon",
        icon: oneOf(o.icon, CENTRE_ICONS, "cross"),
        size,
        shape,
        color: color(o.color, "#ffffff"),
        backdropColor: color(o.backdropColor, "#11182a"),
      };
    default:
      return { type: "none" };
  }
}

function normaliseFrame(raw: unknown): QrFrame {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    style: oneOf(o.style, FRAME_STYLES, "none"),
    text: str(o.text, 60),
    position: oneOf(o.position, ["bottom", "top"] as const, "bottom"),
    color: color(o.color, "#11182a"),
    textColor: color(o.textColor, "#ffffff"),
  };
}

/** One definition of a valid design, used on the way in and on the way out. */
export function normaliseDesign(raw: unknown): QrDesign {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    module: oneOf(o.module, MODULE_SHAPES, DEFAULT_DESIGN.module),
    moduleScale: clamp(o.moduleScale, 0.55, 1, 1),
    seed: Math.floor(clamp(o.seed, 1, 1_000_000, 1)),
    letters: str(o.letters, 24),
    eyeFrame: oneOf(o.eyeFrame, EYE_FRAMES, DEFAULT_DESIGN.eyeFrame),
    eyeBall: oneOf(o.eyeBall, EYE_BALLS, DEFAULT_DESIGN.eyeBall),
    fill: normaliseFill(o.fill),
    eyeFrameColor: isHexColor(o.eyeFrameColor) ? o.eyeFrameColor.trim().toLowerCase() : null,
    eyeBallColor: isHexColor(o.eyeBallColor) ? o.eyeBallColor.trim().toLowerCase() : null,
    background: normaliseBackground(o.background),
    centre: normaliseCentre(o.centre),
    frame: normaliseFrame(o.frame),
    /*
     * Never below 2. The standard says four modules of quiet zone and most
     * scanners manage on two; at zero the code's edge and whatever it is
     * printed next to become the same thing, which is a failure that looks
     * like a bad camera.
     */
    margin: Math.round(clamp(o.margin, 2, 10, 4)),
    cornerRadius: clamp(o.cornerRadius, 0, 8, 0),
    ecLevel: oneOf(o.ecLevel, EC_LEVELS, "M"),
    minVersion: Math.round(clamp(o.minVersion, 1, 20, 1)),
  };
}

/* ============================================================
 * Presets
 *
 * What a church actually picks from. Each one is a complete design, chosen so
 * that the list reads as nine different ideas rather than one idea in nine
 * colours — and every one of them passes `verify.ts` at its default settings
 * with a logo of the default size, which `design.test.ts` asserts so that a
 * preset cannot be shipped broken.
 *
 * `brand` is substituted for the church's own theme colour where it appears,
 * so the same preset looks like the church that chose it.
 * ========================================================== */

export type QrPreset = {
  id: string;
  name: string;
  /** Where it earns its keep — shown under the name. */
  blurb: string;
  design: QrDesign;
};

/** Build a design from the default, overriding only what differs. */
function preset(over: Partial<QrDesign>): QrDesign {
  return normaliseDesign({ ...DEFAULT_DESIGN, ...over });
}

export const PRESETS: QrPreset[] = [
  {
    id: "ink",
    name: "Minimal ink",
    blurb: "Black on white, soft corners. Reads from the back of the hall and photocopies cleanly.",
    design: preset({
      module: "rounded",
      eyeFrame: "rounded",
      eyeBall: "rounded",
      fill: { type: "solid", color: "#11182a" },
    }),
  },
  {
    id: "bulletin",
    name: "Sunday bulletin",
    blurb: "Your brand colour, a caption bar underneath. The one to put on a printed sheet.",
    design: preset({
      module: "squircle",
      eyeFrame: "cushion",
      eyeBall: "rounded",
      fill: { type: "solid", color: "#5b3df5" },
      frame: {
        style: "bar",
        text: "SCAN FOR THIS WEEK",
        position: "bottom",
        color: "#5b3df5",
        textColor: "#ffffff",
      },
      cornerRadius: 2,
    }),
  },
  {
    id: "dawn",
    name: "Dawn",
    blurb: "A deep diagonal gradient with circular eyes. Looks made rather than generated.",
    design: preset({
      module: "dot",
      moduleScale: 0.92,
      eyeFrame: "circle",
      eyeBall: "circle",
      /*
       * The light end was sky-500 (#0ea5e9) until the preset test measured it:
       * 2.8:1 on white, below the floor, so this preset shipped as a code that
       * would not reliably scan. #075985 is the same hue three steps darker,
       * at 7.6:1.
       */
      fill: { type: "linear", from: "#5b3df5", to: "#075985", angle: 45 },
      background: { type: "solid", color: "#ffffff" },
      cornerRadius: 3,
    }),
  },
  {
    id: "stainedglass",
    name: "Stained glass",
    blurb: "Concentric bands of colour out from the middle, like light through a window.",
    design: preset({
      module: "squircle",
      eyeFrame: "flower",
      eyeBall: "flower",
      // Every band is at least 5:1 against the cream ground; the orange and
      // the teal were two steps lighter and measured 3.4 and 3.6.
      fill: { type: "rings", colors: ["#be123c", "#c2410c", "#5b3df5", "#115e59"] },
      background: { type: "solid", color: "#fffaf3" },
      cornerRadius: 4,
    }),
  },
  {
    id: "monogram",
    name: "Monogram",
    blurb: "Your church's initials in the middle, on a dense grid built to hold them.",
    design: preset({
      module: "fluid",
      eyeFrame: "rounded",
      eyeBall: "circle",
      fill: { type: "solid", color: "#11182a" },
      centre: {
        type: "monogram",
        text: "GH",
        size: 0.22,
        shape: "circle",
        color: "#ffffff",
        backdropColor: "#5b3df5",
      },
      // High correction and a denser grid, because the middle is spent.
      ecLevel: "H",
      minVersion: 5,
    }),
  },
  {
    id: "photowall",
    name: "Photo wall",
    blurb: "The modules are windows onto one of your own photographs.",
    design: preset({
      module: "square",
      eyeFrame: "square",
      eyeBall: "square",
      fill: { type: "image", url: "" },
      background: { type: "solid", color: "#ffffff" },
      eyeFrameColor: "#11182a",
      eyeBallColor: "#11182a",
      ecLevel: "H",
    }),
  },
  {
    id: "scripture",
    name: "Scripture",
    blurb: "Letters instead of squares — a word, a reference, a name, repeating through the grid.",
    design: preset({
      module: "letters",
      letters: "GRACE",
      moduleScale: 1,
      eyeFrame: "square",
      eyeBall: "square",
      fill: { type: "solid", color: "#0d5f4f" },
      background: { type: "solid", color: "#f7faf8" },
      ecLevel: "Q",
      // Letters are sparse, so the grid is kept small enough to read them.
      minVersion: 2,
    }),
  },
  {
    id: "welcomedesk",
    name: "Welcome desk",
    blurb: "A card with a ribbon. Stands up in an acrylic holder and looks deliberate.",
    design: preset({
      module: "rounded",
      eyeFrame: "leaf",
      eyeBall: "leaf",
      fill: { type: "solid", color: "#115e59" },
      background: { type: "solid", color: "#ffffff" },
      frame: {
        style: "ribbon",
        text: "NEW HERE? START HERE",
        position: "bottom",
        color: "#115e59",
        textColor: "#ffffff",
      },
      cornerRadius: 2,
    }),
  },
  {
    id: "offeringboard",
    name: "Offering board",
    blurb: "Big, dark, high contrast, with a cross in the middle. Built to be read from a seat.",
    design: preset({
      module: "square",
      eyeFrame: "square",
      eyeBall: "square",
      fill: { type: "solid", color: "#11182a" },
      background: { type: "solid", color: "#ffffff" },
      centre: {
        type: "icon",
        icon: "cross",
        size: 0.18,
        shape: "square",
        color: "#ffffff",
        backdropColor: "#11182a",
      },
      frame: {
        style: "card",
        text: "GIVE",
        position: "bottom",
        color: "#11182a",
        textColor: "#ffffff",
      },
      ecLevel: "H",
      minVersion: 4,
    }),
  },
  {
    id: "harvest",
    name: "Harvest",
    blurb: "Warm, organic, fluid modules that join up. For a programme or a thanksgiving.",
    design: preset({
      module: "fluid",
      eyeFrame: "cushion",
      eyeBall: "rounded",
      fill: { type: "linear", from: "#b45309", to: "#be123c", angle: 135 },
      background: { type: "linear", from: "#fffbeb", to: "#fff1f2", angle: 135 },
      cornerRadius: 4,
    }),
  },
  {
    id: "mosaic",
    name: "Mosaic",
    blurb: "Modules of slightly different sizes, like tesserae. No two codes look the same.",
    design: preset({
      module: "mosaic",
      moduleScale: 0.95,
      eyeFrame: "beveled",
      eyeBall: "diamond",
      fill: { type: "radial", from: "#7c3aed", to: "#1e293b" },
      background: { type: "solid", color: "#ffffff" },
      cornerRadius: 3,
      ecLevel: "Q",
    }),
  },
  {
    id: "night",
    name: "Night service",
    blurb: "Light modules on a dark field. Some older scanners refuse inverted codes, so test it.",
    design: preset({
      module: "rounded",
      eyeFrame: "rounded",
      eyeBall: "circle",
      fill: { type: "solid", color: "#f8fafc" },
      background: { type: "linear", from: "#11182a", to: "#312e81", angle: 160 },
      cornerRadius: 4,
      ecLevel: "Q",
    }),
  },
];

export const PRESET_BY_ID: Record<string, QrPreset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
);

/**
 * A preset in a church's own colours.
 *
 * Only the indigo the presets are written in is replaced, and only where it is
 * the single most prominent colour — a preset built around a deliberate colour
 * relationship (Stained glass, Harvest) keeps it, because substituting one
 * band of four produces something nobody chose.
 */
export function brandPreset(p: QrPreset, brand: string | null | undefined): QrDesign {
  if (!isHexColor(brand)) return p.design;
  const b = brand.trim().toLowerCase();
  const swap = (c: string): string => (c === "#5b3df5" ? b : c);
  const design = structuredCloneish(p.design);

  if (design.fill.type === "solid") design.fill.color = swap(design.fill.color);
  if (design.fill.type === "linear") {
    design.fill.from = swap(design.fill.from);
    design.fill.to = swap(design.fill.to);
  }
  if (design.fill.type === "radial") {
    design.fill.from = swap(design.fill.from);
    design.fill.to = swap(design.fill.to);
  }
  if (design.frame.style !== "none") design.frame.color = swap(design.frame.color);
  if (design.centre.type !== "none") {
    design.centre.backdropColor = swap(design.centre.backdropColor);
  }
  return design;
}

/**
 * A deep copy without `structuredClone`, which is missing in some of the
 * runtimes this file is imported from. The design is plain JSON by
 * construction, so this is exact rather than a best effort.
 */
function structuredCloneish(design: QrDesign): QrDesign {
  return JSON.parse(JSON.stringify(design)) as QrDesign;
}

/* ============================================================
 * How small a grid a decoration can live on
 * ========================================================== */

/**
 * The smallest version whose middle is clear of the code's own structure.
 *
 * FOUND BY A TEST, NOT BY READING THE SPECIFICATION. The 30% cap on the centre
 * was assumed to make an unrepairable overlap impossible, and a test written to
 * assert that found the opposite: at version 1 the symbol is only 21 modules
 * across, so the format information on row and column 8 and the finder
 * separators on row and column 7 pass straight through the middle third. A 30%
 * plate there covers eight modules that carry no redundancy at all, and no
 * correction level and no amount of error-correction budget can recover them.
 *
 * The arithmetic: the plate's near edge sits at `size * (1 - c) / 2`, and the
 * outermost structure near the middle is the format row, whose modules are
 * sampled at 8.5. So the plate is clear when `size * (1 - c) / 2 > 8.5`.
 *
 * The designer applies this the moment a middle is chosen, which is what makes
 * the unrepairable failure unreachable through the interface rather than merely
 * unlikely. `verify.ts` still checks for it — a design also arrives from a
 * stored row and from a server action.
 */
export function minVersionForCentre(centreSize: number): number {
  const c = Math.min(0.3, Math.max(0, centreSize));
  const neededSize = 17 / (1 - c);
  // size = version * 4 + 17, and the comparison is strict, so round upward.
  const version = Math.ceil((neededSize + 1e-9 - 17) / 4);
  return Math.max(1, Math.min(20, version));
}

/** The floor a design's own decorations imply, whatever `minVersion` says. */
export function structuralMinVersion(design: QrDesign): number {
  if (design.centre.type === "none") return 1;
  if (design.centre.type === "image" && !design.centre.url) return 1;
  return minVersionForCentre(design.centre.size);
}

/** Church initials, for the monogram preset. "Grace House Chapel" → "GHC". */
export function initialsOf(name: string, max = 3): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0 && !/^(the|of|and|a|an)$/i.test(w));
  if (words.length === 0) return "";
  return words
    .slice(0, max)
    .map((w) => w[0].toUpperCase())
    .join("");
}
