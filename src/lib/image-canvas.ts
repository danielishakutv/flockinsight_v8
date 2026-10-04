/**
 * The pixels. Browser only — every function here needs a canvas.
 *
 * Deliberately NOT marked `server-only` and deliberately never imported by
 * anything on the server: the companion file `image-studio.ts` holds the rules
 * so they can be unit-tested, and this holds the drawing so it can run on a
 * phone. Nothing here does arithmetic that matters; nothing there touches a
 * canvas.
 *
 * Two things worth knowing before changing anything in here.
 *
 * EXIF ORIENTATION IS LOAD-TIME. Phone cameras store a landscape sensor image
 * plus "rotate this 90°". `createImageBitmap(file, { imageOrientation:
 * "from-image" })` applies it; without that flag a portrait photo is branded
 * sideways, and the watermark ends up on what the photographer saw as the left
 * edge. It also means the dimensions we measure are the ones a person sees.
 *
 * AND THE RE-ENCODE DROPS THE REST OF THE EXIF, including GPS. That is a
 * feature, not a side effect: a church posting a photo taken in somebody's
 * home should not be publishing that address, and almost nobody knows the
 * coordinates are in the file at all.
 */

import {
  coverCrop,
  fitWithin,
  placeWatermark,
  placementKeyFor,
  type Box,
  type StudioPreset,
  SIZE_PRESETS,
  ASPECT_PRESETS,
} from "@/lib/image-studio";

export type LoadedImage = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
};

/** Decode a file, honouring the camera's rotation flag. */
export async function loadBitmap(blob: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images.");
  return ctx;
}

/** Encode a canvas, falling back to PNG only if the browser refuses the type. */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), format, quality / 100),
  );
  if (blob && blob.type === format) return blob;
  if (blob) return blob; // the browser chose another type; still a valid image
  throw new Error("Could not save the processed image.");
}

/* ============================================================
 * The logo
 * ========================================================== */

/**
 * Knock a flat background out of a logo.
 *
 * A church logo nearly always arrives as a JPEG or PNG on solid white —
 * exported from Word, or lifted off a letterhead — and dropped onto a
 * photograph it shows as an ugly white box. Proper matting needs a model; this
 * needs to work on a five-year-old Android in under a second.
 *
 * So: a flood fill inward from the four corners, clearing every pixel within
 * `tolerance` of the colour found there. That is exactly right for the common
 * case and, crucially, cannot eat the middle of the logo — a white letter
 * enclosed by dark ink is never reached from an edge, because the fill cannot
 * cross the ink.
 *
 * An iterative stack, not recursion: a 2000px logo would blow the call stack.
 */
export function removeFlatBackground(
  source: ImageBitmap | HTMLCanvasElement,
  tolerance = 24,
): HTMLCanvasElement {
  const width = "width" in source ? source.width : 0;
  const height = "height" in source ? source.height : 0;
  const canvas = makeCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.drawImage(source as CanvasImageSource, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const w = canvas.width;
  const h = canvas.height;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];

  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  // The tolerance is compared against the sum over three channels, so it is
  // scaled here once rather than inside the loop.
  const limit = tolerance * 3;

  for (const corner of corners) {
    const base = corner * 4;
    const r0 = data[base];
    const g0 = data[base + 1];
    const b0 = data[base + 2];
    stack.push(corner);

    while (stack.length) {
      const index = stack.pop() as number;
      if (seen[index]) continue;
      seen[index] = 1;

      const at = index * 4;
      if (data[at + 3] === 0) continue; // already clear
      const diff =
        Math.abs(data[at] - r0) +
        Math.abs(data[at + 1] - g0) +
        Math.abs(data[at + 2] - b0);
      if (diff > limit) continue;

      data[at + 3] = 0;

      const x = index % w;
      const y = (index - x) / w;
      if (x > 0) stack.push(index - 1);
      if (x < w - 1) stack.push(index + 1);
      if (y > 0) stack.push(index - w);
      if (y < h - 1) stack.push(index + w);
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Trim fully transparent edges.
 *
 * What a person means by "crop my logo" nine times in ten: the PNG has 200px
 * of nothing around it, so at 20% of the photo's width the mark itself is
 * tiny. Run after background removal and the size slider starts meaning what
 * it looks like it means.
 */
export function trimTransparent(
  source: HTMLCanvasElement | ImageBitmap,
): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;
  const canvas = makeCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  // Nothing visible at all — hand back what we were given rather than a
  // zero-sized canvas that would throw on the next draw.
  if (right < 0 || bottom < 0) return canvas;

  return cropCanvas(canvas, {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  });
}

/** Cut a rectangle out of a canvas or bitmap. */
export function cropCanvas(
  source: HTMLCanvasElement | ImageBitmap,
  box: Box,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const canvas = makeCanvas(width, height);
  context2d(canvas).drawImage(
    source as CanvasImageSource,
    Math.round(box.x),
    Math.round(box.y),
    width,
    height,
    0,
    0,
    width,
    height,
  );
  return canvas;
}

/* ============================================================
 * The photograph
 * ========================================================== */

export type RenderInput = {
  photo: ImageBitmap;
  /** Already background-removed and trimmed, or null for text only. */
  logo: HTMLCanvasElement | ImageBitmap | null;
  preset: StudioPreset;
};

export type RenderOutput = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

/**
 * Crop, scale, watermark and letter a photograph, in that order.
 *
 * The order is the whole correctness of this function. Cropping last would
 * slice the logo in half; scaling after the watermark would resample it
 * twice and soften it. Crop → scale → brand means the logo is drawn once, at
 * the final size, on the final shape.
 */
export function renderBranded({ photo, logo, preset }: RenderInput): RenderOutput {
  const ratio = ASPECT_PRESETS.find((a) => a.id === preset.aspect)?.ratio ?? 0;
  const crop = coverCrop(photo.width, photo.height, ratio);

  const maxDim = SIZE_PRESETS.find((s) => s.id === preset.size)?.maxDim ?? 0;
  const out = fitWithin(crop.width, crop.height, maxDim);

  const canvas = makeCanvas(out.width, out.height);
  const ctx = context2d(canvas);
  /*
   * Quality hints for the downscale. The default is a cheap nearest-ish
   * filter in some browsers, which puts jagged edges on every roof line and
   * is exactly the "lost quality" a church would blame the app for.
   */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    photo,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    out.width,
    out.height,
  );

  if (logo) {
    const key = placementKeyFor(out.width, out.height);
    const placement = preset.placement[key];
    const box = placeWatermark(
      { width: out.width, height: out.height },
      { width: logo.width, height: logo.height },
      placement,
    );
    ctx.save();
    ctx.globalAlpha = Math.max(0.05, Math.min(1, placement.opacity / 100));
    ctx.drawImage(logo as CanvasImageSource, box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  if (preset.text.enabled && preset.text.text.trim()) {
    drawText(ctx, out.width, out.height, preset);
  }

  return { canvas, width: out.width, height: out.height };
}

/**
 * One line of text, with an optional bar behind it.
 *
 * The bar is on by default and matters more than it sounds: white words over a
 * photograph are unreadable about half the time, and the half you cannot
 * predict is the half with a bright sky in it.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: StudioPreset,
): void {
  const t = preset.text;
  const shortSide = Math.min(width, height);
  const fontSize = Math.max(10, (t.sizePct / 100) * shortSide);
  const pad = fontSize * 0.5;

  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(t.text);
  const textWidth = Math.min(metrics.width, width - pad * 2);
  const lineHeight = fontSize * 1.25;

  const [vertical, horizontal] = t.anchor.split("-");
  const margin = shortSide * 0.04;

  const x =
    horizontal === "left"
      ? margin + pad
      : horizontal === "right"
        ? width - margin - pad - textWidth
        : (width - textWidth) / 2;
  const baseline =
    vertical === "top"
      ? margin + lineHeight
      : vertical === "bottom"
        ? height - margin - lineHeight * 0.35
        : height / 2 + fontSize * 0.35;

  ctx.globalAlpha = Math.max(0.05, Math.min(1, t.opacity / 100));

  if (t.backdrop) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(
      x - pad,
      baseline - lineHeight * 0.95,
      textWidth + pad * 2,
      lineHeight * 1.25,
    );
  }

  ctx.fillStyle = t.color;
  ctx.fillText(t.text, x, baseline, width - pad * 2);
  ctx.restore();
}

/* ============================================================
 * Getting it off the device
 * ========================================================== */

/**
 * Hand a blob to the browser as a download.
 *
 * The object URL is revoked on a timer rather than immediately: Safari has
 * never reliably finished with it by the time the click handler returns, and
 * revoking too early produces a download of zero bytes with no error anywhere.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A preview small enough to paint at sixty frames a second.
 *
 * Re-rendering a 12-megapixel photo on every drag of the size slider janks
 * even a desktop. The preview is rendered from a downscaled copy of the photo
 * and the export re-renders from the original — the placement arithmetic is in
 * percentages, so both come out identical.
 */
export const PREVIEW_MAX_DIM = 1200;

export async function previewBitmap(blob: Blob): Promise<LoadedImage> {
  const full = await loadBitmap(blob);
  const target = fitWithin(full.width, full.height, PREVIEW_MAX_DIM);
  if (target.width === full.width && target.height === full.height) return full;

  const canvas = makeCanvas(target.width, target.height);
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full.bitmap, 0, 0, target.width, target.height);
  full.bitmap.close?.();

  const bitmap = await createImageBitmap(canvas);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
