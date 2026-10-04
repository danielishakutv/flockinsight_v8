/**
 * A symbol plus a design, as SVG.
 *
 * Pure: a string in, a string out, no DOM. That is what lets the same function
 * draw the live preview in the designer, the file a church downloads, and the
 * image the verifier rasterises to check — one renderer, so the thing that was
 * checked is the thing that gets printed.
 *
 * THREE DECISIONS WORTH KNOWING.
 *
 * 1. ALL THE DATA MODULES ARE ONE `<path>`. A version-10 code has about 1,500
 *    dark modules; as 1,500 `<rect>` elements that is a 120KB file and a
 *    preview that stutters on a mid-range Android as you drag a slider. As one
 *    path with 1,500 subpaths it is about 25KB and redraws instantly. It also
 *    means a gradient or a photograph fill is declared once and applies to the
 *    whole code, rather than being resolved per element.
 *
 * 2. THE EYES' LIGHT RING IS A HOLE, not a light-coloured shape. Drawn with
 *    the even-odd fill rule, so whatever is behind the code shows through. The
 *    obvious alternative — paint the inner ring in the background colour —
 *    looks identical on a white background and wrong on every other one.
 *
 * 3. IDS ARE DERIVED FROM THE CONTENT. Gradients and patterns need ids, and
 *    two codes on one page with the same id means the second one silently
 *    takes the first one's colours. A random id would fix that and make the
 *    output different on every render, so nothing could be compared or
 *    cached; the id is a hash of what is being drawn instead.
 */

import {
  Role,
  eyeOrigins,
  moduleAt,
  roleAt,
  type QrSymbol,
} from "@/lib/qr/encode";
import {
  type QrBackground,
  type QrDesign,
  type QrFill,
} from "@/lib/qr/design";
import {
  ICON_PATHS,
  ICON_STROKED,
  circle,
  eyeBallPath,
  eyeFramePath,
  modulePath,
  n,
  rect,
  roundedRect,
  type Neighbours,
} from "@/lib/qr/shapes";

const FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** XML-escape, for anything a person typed. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A short, stable id from a string. Content-derived, so renders are stable. */
function hashId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/* ============================================================
 * Layout
 *
 * Everything is in module units. The frame is the only thing that changes the
 * overall box, and it does so by adding bands outside the quiet zone — never
 * by eating into it, because the quiet zone is the one measurement a scanner
 * depends on.
 * ========================================================== */

export type QrLayout = {
  /** Modules across the symbol itself. */
  symbolSize: number;
  /** Where the symbol's top-left module sits in the viewBox. */
  offsetX: number;
  offsetY: number;
  /** The whole image, in module units. */
  width: number;
  height: number;
  /** The caption band, if there is one. */
  caption: { x: number; y: number; width: number; height: number } | null;
};

/** How tall each frame style's caption band is, in modules. */
function captionHeight(design: QrDesign): number {
  switch (design.frame.style) {
    case "none":
      return 0;
    case "bar":
      return 4;
    case "ribbon":
      return 4.6;
    case "card":
      return 5;
    case "ticket":
      return 5.4;
    case "badge":
      return 4.2;
  }
}

/** Padding a frame adds around the code, in modules. */
function framePadding(design: QrDesign): number {
  switch (design.frame.style) {
    case "card":
    case "ticket":
      return 1.6;
    default:
      return 0;
  }
}

export function layoutFor(symbol: QrSymbol, design: QrDesign): QrLayout {
  const symbolSize = symbol.size;
  const quiet = design.margin;
  const pad = framePadding(design);
  const cap = design.frame.style === "none" || !design.frame.text.trim() ? 0 : captionHeight(design);

  const inner = symbolSize + quiet * 2;
  const width = inner + pad * 2;
  const height = inner + pad * 2 + cap;

  const top = design.frame.position === "top" ? cap : 0;

  return {
    symbolSize,
    offsetX: pad + quiet,
    offsetY: top + pad + quiet,
    width,
    height,
    caption: cap
      ? {
          x: 0,
          y: design.frame.position === "top" ? 0 : inner + pad * 2,
          width,
          height: cap,
        }
      : null,
  };
}

/* ============================================================
 * Paint
 * ========================================================== */

type Paint = { ref: string; defs: string };

function gradientStops(from: string, to: string): string {
  return `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`;
}

/**
 * `rings` as hard-edged concentric bands.
 *
 * Two stops at the same offset is what makes a gradient step rather than
 * blend. A smooth blend of four colours out from the middle reads as mud; the
 * hard edges are what makes it look like glass.
 */
function ringStops(colors: string[]): string {
  const bands = colors.length;
  let out = "";
  for (let i = 0; i < bands; i++) {
    const start = i / bands;
    const end = (i + 1) / bands;
    out += `<stop offset="${n(start)}" stop-color="${colors[i]}"/>`;
    out += `<stop offset="${n(end)}" stop-color="${colors[i]}"/>`;
  }
  return out;
}

/** An angle in degrees to the two ends of a unit-box linear gradient. */
function gradientVector(angle: number): string {
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return `x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}"`;
}

function fillPaint(fill: QrFill, id: string, box: QrLayout): Paint {
  switch (fill.type) {
    case "solid":
      return { ref: fill.color, defs: "" };

    case "linear":
      return {
        ref: `url(#${id})`,
        defs: `<linearGradient id="${id}" ${gradientVector(fill.angle)}>${gradientStops(fill.from, fill.to)}</linearGradient>`,
      };

    case "radial":
      return {
        ref: `url(#${id})`,
        defs: `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.7">${gradientStops(fill.from, fill.to)}</radialGradient>`,
      };

    case "rings":
      return {
        ref: `url(#${id})`,
        defs: `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.72">${ringStops(fill.colors)}</radialGradient>`,
      };

    case "image": {
      if (!fill.url) return { ref: "#11182a", defs: "" };
      /*
       * `userSpaceOnUse` over the whole image, not over each module: the
       * photograph is laid across the code once and the modules are windows
       * onto it. Per-module tiling would put a whole shrunken photograph in
       * every module, which is a different (and much worse) idea.
       */
      return {
        ref: `url(#${id})`,
        defs:
          `<pattern id="${id}" patternUnits="userSpaceOnUse" x="0" y="0" ` +
          `width="${n(box.width)}" height="${n(box.height)}">` +
          `<image href="${esc(fill.url)}" x="0" y="0" width="${n(box.width)}" ` +
          `height="${n(box.height)}" preserveAspectRatio="xMidYMid slice"/>` +
          `</pattern>`,
      };
    }
  }
}

function backgroundMarkup(
  background: QrBackground,
  design: QrDesign,
  box: QrLayout,
  id: string,
): { defs: string; body: string } {
  const r = design.cornerRadius;
  const shape = r > 0 ? roundedRect(0, 0, box.width, box.height, r) : rect(0, 0, box.width, box.height);

  switch (background.type) {
    case "transparent":
      return { defs: "", body: "" };

    case "solid":
      return { defs: "", body: `<path d="${shape}" fill="${background.color}"/>` };

    case "linear":
      return {
        defs: `<linearGradient id="${id}" ${gradientVector(background.angle)}>${gradientStops(background.from, background.to)}</linearGradient>`,
        body: `<path d="${shape}" fill="url(#${id})"/>`,
      };

    case "image": {
      if (!background.url) {
        return { defs: "", body: `<path d="${shape}" fill="${background.scrimColor}"/>` };
      }
      /*
       * The photograph, then a flat wash over it. The wash is what makes the
       * code readable; see the floor on `scrim` in design.ts for why it cannot
       * be turned off.
       */
      return {
        defs:
          `<clipPath id="${id}-clip"><path d="${shape}"/></clipPath>`,
        body:
          `<g clip-path="url(#${id}-clip)">` +
          `<image href="${esc(background.url)}" x="0" y="0" width="${n(box.width)}" ` +
          `height="${n(box.height)}" preserveAspectRatio="xMidYMid slice"/>` +
          `<path d="${shape}" fill="${background.scrimColor}" opacity="${n(background.scrim)}"/>` +
          `</g>`,
      };
    }
  }
}

/* ============================================================
 * The modules
 * ========================================================== */

/** Is this module one of the three finder eyes, which are drawn separately? */
function inEye(symbol: QrSymbol, x: number, y: number): boolean {
  return roleAt(symbol, x, y) === Role.Finder;
}

function neighboursOf(symbol: QrSymbol, x: number, y: number): Neighbours {
  // A neighbour inside an eye does not count: the eyes are drawn as whole
  // shapes, so a data module must not grow a square corner to meet one.
  const dark = (dx: number, dy: number): boolean =>
    moduleAt(symbol, x + dx, y + dy) && !inEye(symbol, x + dx, y + dy);
  return {
    up: dark(0, -1),
    down: dark(0, 1),
    left: dark(-1, 0),
    right: dark(1, 0),
  };
}

/**
 * Every dark data module as one path, and the letters separately.
 *
 * Returns both because `letters` cannot be a path — text is text — and a
 * design using it still needs the eyes and the fill wired up the same way.
 */
function modulesMarkup(
  symbol: QrSymbol,
  design: QrDesign,
  box: QrLayout,
  paint: Paint,
): string {
  const { offsetX, offsetY } = box;
  const needsNeighbours = design.module === "fluid";

  if (design.module === "letters") {
    const letters = design.letters.replace(/\s+/g, "") || "QR";
    const glyphs: string[] = [];
    let i = 0;
    for (let y = 0; y < symbol.size; y++) {
      for (let x = 0; x < symbol.size; x++) {
        if (!moduleAt(symbol, x, y) || inEye(symbol, x, y)) continue;
        const ch = letters[i % letters.length];
        i++;
        glyphs.push(
          `<text x="${n(offsetX + x + 0.5)}" y="${n(offsetY + y + 0.54)}">${esc(ch)}</text>`,
        );
      }
    }
    /*
     * The font size is pushed slightly past the cell (1.06) on purpose: a
     * capital letter's ink covers perhaps 70% of its em box, so a letter set
     * to exactly one module leaves more white than a dot of the same nominal
     * size and reads as a lighter module. This is the compensation, and
     * `verify.ts` still counts letters among the sparse shapes.
     */
    return (
      `<g fill="${paint.ref}" font-family="${FONT}" font-weight="700" ` +
      `font-size="${n(1.06 * design.moduleScale)}" text-anchor="middle" ` +
      `dominant-baseline="central">${glyphs.join("")}</g>`
    );
  }

  let d = "";
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      if (!moduleAt(symbol, x, y) || inEye(symbol, x, y)) continue;
      d += modulePath(
        design.module,
        offsetX + x,
        offsetY + y,
        design.moduleScale,
        needsNeighbours ? neighboursOf(symbol, x, y) : undefined,
        design.seed,
      );
    }
  }
  return d ? `<path d="${d}" fill="${paint.ref}"/>` : "";
}

function eyesMarkup(symbol: QrSymbol, design: QrDesign, box: QrLayout, paint: Paint): string {
  let frames = "";
  let balls = "";
  for (const { x, y } of eyeOrigins(symbol.size)) {
    frames += eyeFramePath(design.eyeFrame, box.offsetX + x, box.offsetY + y);
    balls += eyeBallPath(design.eyeBall, box.offsetX + x, box.offsetY + y);
  }
  const frameFill = design.eyeFrameColor ?? paint.ref;
  const ballFill = design.eyeBallColor ?? paint.ref;
  // even-odd so the ring's inside is a hole, not a light-coloured shape.
  return (
    `<path d="${frames}" fill="${frameFill}" fill-rule="evenodd"/>` +
    `<path d="${balls}" fill="${ballFill}"/>`
  );
}

/* ============================================================
 * The middle
 * ========================================================== */

/** The box the centre overlay occupies, in module units. Null for none. */
export function centreBox(
  symbol: QrSymbol,
  design: QrDesign,
  box: QrLayout,
): { x: number; y: number; size: number } | null {
  if (design.centre.type === "none") return null;
  const size = symbol.size * design.centre.size;
  return {
    x: box.offsetX + (symbol.size - size) / 2,
    y: box.offsetY + (symbol.size - size) / 2,
    size,
  };
}

function plate(shape: string, x: number, y: number, size: number, fill: string): string {
  const d =
    shape === "circle"
      ? circle(x + size / 2, y + size / 2, size / 2)
      : shape === "rounded"
        ? roundedRect(x, y, size, size, size * 0.22)
        : rect(x, y, size, size);
  return `<path d="${d}" fill="${fill}"/>`;
}

function centreMarkup(
  symbol: QrSymbol,
  design: QrDesign,
  box: QrLayout,
  id: string,
): { defs: string; body: string } {
  const centre = design.centre;
  if (centre.type === "none") return { defs: "", body: "" };
  const place = centreBox(symbol, design, box);
  if (!place) return { defs: "", body: "" };
  const { x, y, size } = place;

  if (centre.type === "image") {
    if (!centre.url) return { defs: "", body: "" };
    /*
     * The plate is a tenth larger than the logo on each side. Without it the
     * logo's own light areas are read as light modules and its dark areas as
     * dark ones, so a scanner does not see a hole it can repair — it sees
     * plausible data, and plausible data is not correctable.
     */
    const padded = size * 1.18;
    const px = x - (padded - size) / 2;
    const py = y - (padded - size) / 2;
    const clipId = `${id}-c`;
    const clipShape =
      centre.shape === "circle"
        ? circle(x + size / 2, y + size / 2, size / 2)
        : centre.shape === "rounded"
          ? roundedRect(x, y, size, size, size * 0.18)
          : rect(x, y, size, size);
    return {
      defs: `<clipPath id="${clipId}"><path d="${clipShape}"/></clipPath>`,
      body:
        (centre.backdrop ? plate(centre.shape, px, py, padded, centre.backdropColor) : "") +
        `<image href="${esc(centre.url)}" x="${n(x)}" y="${n(y)}" width="${n(size)}" ` +
        `height="${n(size)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>`,
    };
  }

  if (centre.type === "monogram") {
    const text = centre.text.trim() || "·";
    /*
     * The font shrinks as the monogram gains characters, so "RCCG" fits the
     * same plate as "GH" instead of running off both sides. Measured in
     * module units against the plate's width, not guessed.
     */
    const fontSize = (size * 0.62) / Math.max(1, text.length * 0.62);
    return {
      defs: "",
      body:
        plate(centre.shape, x, y, size, centre.backdropColor) +
        `<text x="${n(x + size / 2)}" y="${n(y + size / 2)}" fill="${centre.color}" ` +
        `font-family="${FONT}" font-weight="800" font-size="${n(fontSize)}" ` +
        `letter-spacing="${n(fontSize * 0.02)}" text-anchor="middle" ` +
        `dominant-baseline="central">${esc(text.toUpperCase())}</text>`,
    };
  }

  // An icon, drawn in its 24-unit box and scaled onto the plate.
  const path = ICON_PATHS[centre.icon] ?? ICON_PATHS.cross;
  const inner = size * 0.64;
  const scale = inner / 24;
  const ix = x + (size - inner) / 2;
  const iy = y + (size - inner) / 2;
  const stroked = ICON_STROKED.has(centre.icon);
  return {
    defs: "",
    body:
      plate(centre.shape, x, y, size, centre.backdropColor) +
      `<g transform="translate(${n(ix)} ${n(iy)}) scale(${n(scale)})" ` +
      (stroked
        ? `fill="none" stroke="${centre.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
        : `fill="${centre.color}"`) +
      `><path d="${path}"/></g>`,
  };
}

/* ============================================================
 * The frame
 * ========================================================== */

function frameMarkup(design: QrDesign, box: QrLayout): { under: string; over: string } {
  const { frame } = design;
  if (!box.caption) return { under: "", over: "" };
  const { x, y, width, height } = box.caption;
  const text = frame.text.trim();
  // Shrinks with the caption's length so a long line stays inside the bar.
  const fontSize = Math.min(height * 0.5, (width * 1.55) / Math.max(8, text.length));
  const label =
    `<text x="${n(x + width / 2)}" y="${n(y + height / 2)}" fill="${frame.textColor}" ` +
    `font-family="${FONT}" font-weight="700" font-size="${n(fontSize)}" ` +
    `letter-spacing="${n(fontSize * 0.06)}" text-anchor="middle" ` +
    `dominant-baseline="central">${esc(text.toUpperCase())}</text>`;

  const r = design.cornerRadius;

  switch (frame.style) {
    case "bar": {
      // Only the outer corners are rounded, so the bar meets the code flush.
      const d =
        frame.position === "bottom"
          ? `M${n(x)} ${n(y)}h${n(width)}v${n(height - r)}` +
            (r > 0 ? `a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}` : "") +
            `h${n(-(width - 2 * r))}` +
            (r > 0 ? `a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}` : "") +
            `Z`
          : `M${n(x)} ${n(y + height)}v${n(-(height - r))}` +
            (r > 0 ? `a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}` : "") +
            `h${n(width - 2 * r)}` +
            (r > 0 ? `a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}` : "") +
            `v${n(height - r)}Z`;
      return { under: "", over: `<path d="${d}" fill="${frame.color}"/>${label}` };
    }

    case "ribbon": {
      // A banner with notched ends, inset from the sides.
      const inset = width * 0.06;
      const notch = height * 0.42;
      const left = x + inset;
      const right = x + width - inset;
      const d =
        `M${n(left)} ${n(y)}h${n(right - left)}l${n(-notch)} ${n(height / 2)}` +
        `l${n(notch)} ${n(height / 2)}h${n(-(right - left))}l${n(notch)} ${n(-height / 2)}Z`;
      return { under: "", over: `<path d="${d}" fill="${frame.color}"/>${label}` };
    }

    case "card": {
      const d = roundedRect(0, 0, box.width, box.height, Math.max(r, 1.2));
      return { under: `<path d="${d}" fill="${frame.color}"/>`, over: label };
    }

    case "ticket": {
      const radius = Math.max(r, 1.2);
      const d = roundedRect(0, 0, box.width, box.height, radius);
      // Two notches punched into the sides where the stub would tear off.
      const notchY = frame.position === "bottom" ? y : y + height;
      const hole = 0.9;
      const notches =
        circle(0, notchY, hole) + circle(box.width, notchY, hole);
      const dashes =
        `<path d="M${n(1.4)} ${n(notchY)}H${n(box.width - 1.4)}" stroke="${frame.color}" ` +
        `stroke-width="0.22" stroke-dasharray="0.7 0.7" opacity="0.55"/>`;
      return {
        under: `<path d="${d}" fill="${frame.color}"/>`,
        over: `<path d="${notches}" fill="#ffffff"/>${dashes}${label}`,
      };
    }

    case "badge": {
      // A pill that sits over the bottom edge of the code.
      const pillH = height * 0.78;
      const pillW = Math.min(box.width * 0.78, Math.max(box.width * 0.4, text.length * fontSize * 0.74));
      const px = (box.width - pillW) / 2;
      const py = frame.position === "bottom" ? y + (height - pillH) / 2 : y + (height - pillH) / 2;
      const d = roundedRect(px, py, pillW, pillH, pillH / 2);
      const centredLabel = label.replace(
        /y="[^"]*"/,
        `y="${n(py + pillH / 2)}"`,
      );
      return { under: "", over: `<path d="${d}" fill="${frame.color}"/>${centredLabel}` };
    }

    case "none":
      return { under: "", over: "" };
  }
}

/* ============================================================
 * The whole picture
 * ========================================================== */

export type RenderOptions = {
  /** Width and height in pixels on the root element. Omit for viewBox only. */
  pixelSize?: number;
  /**
   * A short, readable name describing what the code points at, for the
   * `<title>` a screen reader announces and a download's alt text.
   */
  title?: string;
};

export function renderSvg(
  symbol: QrSymbol,
  design: QrDesign,
  options: RenderOptions = {},
): string {
  const box = layoutFor(symbol, design);
  const id = `q${hashId(`${symbol.text}|${symbol.version}|${symbol.mask}|${JSON.stringify(design)}`)}`;

  const paint = fillPaint(design.fill, `${id}-f`, box);
  const background = backgroundMarkup(design.background, design, box, `${id}-b`);
  const frame = frameMarkup(design, box);
  const centre = centreMarkup(symbol, design, box, id);

  const defs = [paint.defs, background.defs, centre.defs].filter(Boolean).join("");
  const dimensions = options.pixelSize
    ? ` width="${options.pixelSize}" height="${n((options.pixelSize * box.height) / box.width)}"`
    : "";
  const title = options.title
    ? `<title>${esc(options.title)}</title>`
    : `<title>QR code</title>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(box.width)} ${n(box.height)}"` +
    `${dimensions} role="img" shape-rendering="geometricPrecision">` +
    title +
    (defs ? `<defs>${defs}</defs>` : "") +
    frame.under +
    background.body +
    modulesMarkup(symbol, design, box, paint) +
    eyesMarkup(symbol, design, box, paint) +
    centre.body +
    frame.over +
    `</svg>`
  );
}

/** The SVG as a data URL, for an `<img src>` or a canvas. */
export function svgDataUrl(svg: string): string {
  // encodeURIComponent rather than base64: it is shorter for markup, and it
  // avoids needing btoa, which is not available in every runtime this is
  // imported from.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
