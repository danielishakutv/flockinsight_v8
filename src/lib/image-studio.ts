/**
 * Branding a church's photographs — the rules, with no canvas in sight.
 *
 * WHY THIS MODULE EXISTS AT ALL. Every church posts photographs, and every
 * church wants its name on them. The alternative is a volunteer with a phone
 * app putting the logo somewhere different every week, at a different size,
 * sometimes over somebody's face. One preset, applied to two hundred photos in
 * a batch, is the difference between a church that looks like itself and one
 * that looks like whoever was holding the phone.
 *
 * WHY IT RUNS IN THE BROWSER. Every pixel of this work happens on the device,
 * and that is a deliberate architectural decision rather than a convenience:
 *
 *   - A batch of 200 service photos is well over half a gigabyte. Uploading
 *     that to the VPS to decode, composite and re-encode would pin both PM2
 *     workers for minutes, on a box that has already been taken down once by
 *     resource starvation — and Cloudflare refuses a request body over 100MB
 *     before the app ever sees it.
 *   - Nothing is uploaded, so nothing consumes the church's 200MB quota and
 *     nobody waits on a Nigerian mobile connection to see a preview.
 *   - Re-encoding through a canvas drops the EXIF block, which means the GPS
 *     coordinates of wherever the photo was taken go with it. A church posting
 *     a photo taken in a member's home should not be publishing that address,
 *     and almost nobody knows they are.
 *
 * So this file is pure arithmetic and naming — testable on its own, shared by
 * the preview, the export and the unit tests. `image-canvas.ts` does the
 * drawing; nothing here imports it.
 */

/* ============================================================
 * Where the logo sits
 * ========================================================== */

/**
 * The nine places a watermark is ever actually wanted, plus the two full-width
 * strips churches use for a name bar.
 */
export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const ANCHORS: Anchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/** How a logo is placed on one orientation of photo. */
export type Placement = {
  anchor: Anchor;
  /**
   * The logo's width, as a percentage of the PHOTO's width.
   *
   * A percentage rather than pixels, because the same preset has to look right
   * on a 12-megapixel camera photo and on a screenshot. Pixels would make the
   * logo a postage stamp on one and a billboard on the other.
   */
  sizePct: number;
  /** Gap from the edges, as a percentage of the photo's SHORTER side. */
  marginPct: number;
  /** 0–100. Churches usually want 70–90 over a photograph. */
  opacity: number;
};

export type Orientation = "portrait" | "landscape" | "square";

/** Portrait and landscape are configured separately — see the preset type. */
export type OrientationKey = "portrait" | "landscape";

export const DEFAULT_PLACEMENT: Record<OrientationKey, Placement> = {
  /*
   * Bottom-right for landscape, bottom-centre for portrait.
   *
   * Not symmetry for its own sake: a portrait photo is nearly always a person,
   * and the bottom corners are where an elbow or a hand ends up. The centre
   * strip at the bottom is the one place a logo rarely lands on somebody.
   */
  landscape: { anchor: "bottom-right", sizePct: 18, marginPct: 4, opacity: 85 },
  portrait: { anchor: "bottom-center", sizePct: 30, marginPct: 5, opacity: 85 },
};

/**
 * Which set of settings a photo uses.
 *
 * A square photo takes the LANDSCAPE settings. It has no long edge to lean
 * on, and in practice a square crop is for social media, where the landscape
 * corner placement is what people expect.
 */
export function orientationOf(width: number, height: number): Orientation {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

/** The settings key a photo of these dimensions resolves to. */
export function placementKeyFor(width: number, height: number): OrientationKey {
  return orientationOf(width, height) === "portrait" ? "portrait" : "landscape";
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Where exactly the logo goes, in photo pixels.
 *
 * The logo's aspect ratio is always preserved — a stretched logo is worse than
 * no logo, and it is the first thing a pastor notices. The box is also clamped
 * inside the photo, so a 95% logo with a big margin cannot end up half off the
 * edge.
 */
export function placeWatermark(
  photo: { width: number; height: number },
  logo: { width: number; height: number },
  placement: Placement,
): Box {
  const pw = Math.max(1, photo.width);
  const ph = Math.max(1, photo.height);
  const lw = Math.max(1, logo.width);
  const lh = Math.max(1, logo.height);

  const shortSide = Math.min(pw, ph);
  const margin = (clamp(placement.marginPct, 0, 40) / 100) * shortSide;

  // Width from the percentage, height from the logo's own aspect ratio.
  let width = (clamp(placement.sizePct, 1, 100) / 100) * pw;
  let height = width * (lh / lw);

  /*
   * A tall logo is sized by the HEIGHT it would need, not the width it asked
   * for. A vertical crest at "30% of the width" on a portrait photo would
   * otherwise be taller than the photo itself.
   */
  const maxHeight = ph - margin * 2;
  if (maxHeight > 0 && height > maxHeight) {
    height = maxHeight;
    width = height * (lw / lh);
  }

  const [vertical, horizontal] = splitAnchor(placement.anchor);

  const x =
    horizontal === "left"
      ? margin
      : horizontal === "right"
        ? pw - width - margin
        : (pw - width) / 2;
  const y =
    vertical === "top"
      ? margin
      : vertical === "bottom"
        ? ph - height - margin
        : (ph - height) / 2;

  return {
    x: clamp(x, 0, Math.max(0, pw - width)),
    y: clamp(y, 0, Math.max(0, ph - height)),
    width,
    height,
  };
}

function splitAnchor(anchor: Anchor): [
  "top" | "middle" | "bottom",
  "left" | "center" | "right",
] {
  const [a, b] = anchor.split("-") as [string, string];
  const vertical = a === "top" ? "top" : a === "bottom" ? "bottom" : "middle";
  const horizontal = b === "left" ? "left" : b === "right" ? "right" : "center";
  return [vertical, horizontal];
}

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
 * Size and quality
 * ========================================================== */

/**
 * The longest edge an export may have, and what each is for.
 *
 * "Original" is offered and is NOT the default. A church uploading a 6000px
 * photo to WhatsApp is sending twenty times the pixels anything will display,
 * and the only visible difference is how long it takes to send.
 */
export const SIZE_PRESETS = [
  { id: "social", label: "Social (1600px)", maxDim: 1600 },
  { id: "large", label: "Large (2400px)", maxDim: 2400 },
  { id: "print", label: "Print (3200px)", maxDim: 3200 },
  { id: "original", label: "Original size", maxDim: 0 },
] as const;

export type SizePresetId = (typeof SIZE_PRESETS)[number]["id"];

/**
 * Scale to fit inside `maxDim` on the longest edge, never scaling UP.
 *
 * Enlarging a small photo to hit a target invents pixels and makes the file
 * bigger for a blurrier result, which is the opposite of what anybody wants.
 */
export function fitWithin(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (!maxDim || maxDim <= 0) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxDim) return { width, height };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The aspect ratios a church actually posts to, as cover-crops.
 *
 * "As taken" first, because cropping is a decision and should never be the
 * default — a crop to 1:1 can cut somebody out of their own photograph.
 */
export const ASPECT_PRESETS = [
  { id: "as-is", label: "As taken", ratio: 0 },
  { id: "square", label: "Square · 1:1", ratio: 1 },
  { id: "portrait45", label: "Portrait · 4:5", ratio: 4 / 5 },
  { id: "story", label: "Story · 9:16", ratio: 9 / 16 },
  { id: "wide", label: "Wide · 16:9", ratio: 16 / 9 },
] as const;

export type AspectPresetId = (typeof ASPECT_PRESETS)[number]["id"];

/**
 * The centred crop that fills a target ratio — the biggest rectangle of that
 * shape that fits, centred, so the middle of the photo survives.
 */
export function coverCrop(
  width: number,
  height: number,
  ratio: number,
): Box {
  if (!ratio || ratio <= 0) return { x: 0, y: 0, width, height };
  const current = width / height;
  if (Math.abs(current - ratio) < 0.0001) {
    return { x: 0, y: 0, width, height };
  }
  if (current > ratio) {
    // Too wide: take a full-height slice.
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  // Too tall: take a full-width slice.
  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) / 2), width, height: h };
}

/* ============================================================
 * The preset a church saves
 * ========================================================== */

/** A line of text burned onto the photo — a date, a series, a verse. */
export type TextOverlay = {
  enabled: boolean;
  text: string;
  anchor: Anchor;
  /** Font size as a percentage of the photo's shorter side. */
  sizePct: number;
  color: string;
  /** A translucent bar behind the words, for legibility over a busy photo. */
  backdrop: boolean;
  opacity: number;
};

export const DEFAULT_TEXT: TextOverlay = {
  enabled: false,
  text: "",
  anchor: "bottom-left",
  sizePct: 4,
  color: "#ffffff",
  backdrop: true,
  opacity: 95,
};

export type StudioPreset = {
  /** Separate settings per orientation — a batch of mixed photos needs both. */
  placement: Record<OrientationKey, Placement>;
  text: TextOverlay;
  size: SizePresetId;
  aspect: AspectPresetId;
  /** JPEG/WebP quality, 50–100. */
  quality: number;
  /** "image/webp" | "image/jpeg" */
  format: "image/webp" | "image/jpeg";
};

export const DEFAULT_PRESET: StudioPreset = {
  placement: DEFAULT_PLACEMENT,
  text: DEFAULT_TEXT,
  size: "social",
  aspect: "as-is",
  /*
   * 90, not 100.
   *
   * Above about 92 a JPEG grows quickly for differences nobody can see on a
   * phone. This is the "quality preserved but compressed" setting: a 4MB
   * camera photo lands around 300–500KB with no visible loss, which is what
   * makes a 200-photo batch shareable at all.
   */
  quality: 90,
  /*
   * WebP by default, because it is roughly 30% smaller than JPEG at the same
   * quality and every browser and phone made in the last five years reads it.
   * JPEG stays on offer for whoever has to hand a file to a printer.
   */
  format: "image/webp",
};

/** Mend anything missing or out of range in a stored preset. */
export function normalisePreset(raw: unknown): StudioPreset {
  const p = (raw ?? {}) as Partial<StudioPreset>;
  const place = (p.placement ?? {}) as Partial<Record<OrientationKey, Placement>>;
  const fix = (key: OrientationKey): Placement => {
    const d = DEFAULT_PLACEMENT[key];
    const v = place[key] ?? d;
    return {
      anchor: ANCHORS.includes(v.anchor) ? v.anchor : d.anchor,
      sizePct: clamp(Number(v.sizePct ?? d.sizePct), 1, 100),
      marginPct: clamp(Number(v.marginPct ?? d.marginPct), 0, 40),
      opacity: clamp(Number(v.opacity ?? d.opacity), 5, 100),
    };
  };
  const t = (p.text ?? {}) as Partial<TextOverlay>;
  return {
    placement: { portrait: fix("portrait"), landscape: fix("landscape") },
    text: {
      enabled: !!t.enabled,
      text: String(t.text ?? "").slice(0, 120),
      anchor: ANCHORS.includes(t.anchor as Anchor)
        ? (t.anchor as Anchor)
        : DEFAULT_TEXT.anchor,
      sizePct: clamp(Number(t.sizePct ?? DEFAULT_TEXT.sizePct), 1, 20),
      color: /^#[0-9a-fA-F]{6}$/.test(String(t.color)) ? String(t.color) : "#ffffff",
      backdrop: t.backdrop ?? true,
      opacity: clamp(Number(t.opacity ?? 95), 5, 100),
    },
    size: SIZE_PRESETS.some((s) => s.id === p.size)
      ? (p.size as SizePresetId)
      : DEFAULT_PRESET.size,
    aspect: ASPECT_PRESETS.some((a) => a.id === p.aspect)
      ? (p.aspect as AspectPresetId)
      : DEFAULT_PRESET.aspect,
    quality: clamp(Number(p.quality ?? DEFAULT_PRESET.quality), 50, 100),
    format: p.format === "image/jpeg" ? "image/jpeg" : "image/webp",
  };
}

/* ============================================================
 * Naming what comes out
 * ========================================================== */

/** Strip a file extension, keeping dots inside the name. */
export function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

/**
 * What a processed file is called.
 *
 * The original name is kept and a short suffix added, because somebody has 200
 * of these in a folder and "IMG_4821-branded.webp" can be matched back to the
 * photo it came from. A generated id cannot.
 */
export function outputName(
  original: string,
  format: StudioPreset["format"],
  suffix = "branded",
): string {
  const ext = format === "image/jpeg" ? "jpg" : "webp";
  /*
   * Sanitise FIRST, then fall back.
   *
   * The other way round, a name made entirely of characters a filesystem
   * refuses — "???.jpg" off a camera with a broken charset — survives the
   * fallback and then sanitises down to nothing, producing "-branded.webp":
   * a file with no name, and a whole batch of them colliding.
   */
  const base = safeFilePart(baseName(original).slice(0, 80)) || "photo";
  return `${base}-${suffix}.${ext}`;
}

/** A name for the zip: the church, and today. */
export function zipName(churchName: string, when: Date = new Date()): string {
  const stamp = when.toISOString().slice(0, 10);
  return `${safeFilePart(churchName).slice(0, 40) || "church"}-photos-${stamp}.zip`;
}

/**
 * Make a string safe to be part of a filename, on any operating system.
 *
 * Windows refuses `\\ / : * ? " < > |`, and a leading dot hides the file on
 * Unix. A church called "St. Peter's / Mary's" is a real name and must not
 * produce a file nobody can save.
 */
export function safeFilePart(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "");
}

/* ============================================================
 * Housekeeping
 * ========================================================== */

/**
 * How long a photo saved to the library from the studio is kept.
 *
 * The studio's output is a DERIVATIVE: the church still has the original, and
 * the whole point of saving one here is to get a link into a WhatsApp group or
 * a bulletin this week. Keeping those for ever would quietly eat a 200MB quota
 * with files nobody opens again — so they carry an expiry, and the storage
 * cron removes them.
 */
export const STUDIO_RETENTION_DAYS = 30;

export function studioExpiry(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + STUDIO_RETENTION_DAYS);
  return d;
}

/** "4.2MB → 480KB (89% smaller)", for the line under each photo. */
export function savingLabel(before: number, after: number): string {
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  return `${formatSize(before)} → ${formatSize(after)}${pct > 0 ? ` (${pct}% smaller)` : ""}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
