/**
 * Make a design self-contained, so the picture survives being rasterised.
 *
 * WHY THIS EXISTS — a measured bug, not a precaution.
 *
 * A logo is stored as a URL and rendered as `<image href="https://…">`. On
 * screen that is fine: the preview is inline SVG in the page, so the browser
 * fetches the logo like any other image. But EVERY other thing we do with a
 * code goes through `new Image()` on a `data:` URL — the PNG download, the
 * clipboard copy, and the "read it back" check all rasterise that way — and an
 * SVG loaded through `<img>` is rendered in the spec's secure static mode,
 * where external references are never fetched.
 *
 * So the logo was not merely dropped from the PNG. Chrome paints its
 * BROKEN-IMAGE ICON into the middle of the code instead: a church picked its
 * logo, watched it appear in the preview, downloaded the PNG, and got a grey
 * torn-page glyph in the middle of the thing it was about to print a thousand
 * of. Nothing errored, because nothing failed — the outer SVG loaded perfectly.
 *
 * The fix is to stop referring to the image and start carrying it. Every
 * external URL in the design is fetched once and rewritten as a `data:` URL,
 * after which the markup depends on nothing, and the rasteriser, the printer
 * and the verifier all see the same picture the preview did.
 *
 * It also makes the downloaded SVG self-contained, which matters for the same
 * reason in a different place: a designer opening that file in Illustrator, or
 * a printer opening it at all, is not going to be able to reach our CDN.
 */

import type { QrDesign } from "@/lib/qr/design";

/** Every external image URL a design refers to, in no particular order. */
export function designImageUrls(design: QrDesign): string[] {
  const urls: string[] = [];
  if (design.fill.type === "image" && design.fill.url) urls.push(design.fill.url);
  if (design.background.type === "image" && design.background.url) {
    urls.push(design.background.url);
  }
  if (design.centre.type === "image" && design.centre.url) urls.push(design.centre.url);
  return urls.filter((url) => !url.startsWith("data:"));
}

/** Does this design refer to anything a rasteriser would have to go and fetch? */
export function needsInlining(design: QrDesign): boolean {
  return designImageUrls(design).length > 0;
}

export type InlineResult =
  | { ok: true; design: QrDesign }
  | { ok: false; error: string; url: string };

/**
 * Rewrite every external image in a design as a `data:` URL.
 *
 * Returns the design untouched when there is nothing to do, so the common case
 * — no logo — costs one array check and no network at all.
 *
 * THE ERROR NAMES THE CAUSE. There are only two ways this fails and they need
 * different things from a church: the file is not there any more (re-upload
 * it), or it is somewhere that will not let a browser read it back (the host's
 * CORS headers, which is not something they chose or can see). Saying "could
 * not load image" for both sends somebody looking at their design for a fault
 * that is not in it.
 */
export async function inlineDesignImages(design: QrDesign): Promise<InlineResult> {
  const urls = designImageUrls(design);
  if (urls.length === 0) return { ok: true, design };

  const map = new Map<string, string>();
  for (const url of urls) {
    if (map.has(url)) continue;
    const data = await fetchAsDataUrl(url);
    if (!data.ok) return { ok: false, error: data.error, url };
    map.set(url, data.dataUrl);
  }

  const swap = (url: string): string => map.get(url) ?? url;
  const next: QrDesign = {
    ...design,
    fill: design.fill.type === "image" ? { ...design.fill, url: swap(design.fill.url) } : design.fill,
    background:
      design.background.type === "image"
        ? { ...design.background, url: swap(design.background.url) }
        : design.background,
    centre:
      design.centre.type === "image"
        ? { ...design.centre, url: swap(design.centre.url) }
        : design.centre,
  };
  return { ok: true, design: next };
}

type FetchResult = { ok: true; dataUrl: string } | { ok: false; error: string };

async function fetchAsDataUrl(url: string): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(url, { mode: "cors", credentials: "omit" });
  } catch {
    /*
     * A thrown fetch is the CORS case. The request usually went out and the
     * reply usually came back — the browser simply refuses to hand it over,
     * and deliberately does not say so in a way a script can read.
     */
    return {
      ok: false,
      error:
        "The image in the middle is served from somewhere that will not let this page read it back, so it cannot be built into the file. Upload the logo here instead of linking to it, and this will work.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `The image in the middle could not be fetched (the server answered ${response.status}). It may have been moved or deleted — choose it again.`,
    };
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    return {
      ok: false,
      error: "The file in the middle is not an image, so it cannot be drawn into the code.",
    };
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { ok: true, dataUrl: `data:${blob.type};base64,${base64(bytes)}` };
  } catch (error) {
    console.error("[qr] could not read an image into the design", error);
    return { ok: false, error: "The image could not be read into the file." };
  }
}

/**
 * Base64, in chunks.
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-liner everybody writes and
 * it throws on a logo of any size: spreading a few hundred thousand bytes into
 * an argument list overflows the call stack. 0x8000 at a time is well inside
 * every engine's limit.
 *
 * Not `FileReader`, which would be the other obvious way, because this is then
 * testable off a browser — and the thing most worth a test here is that a
 * `data:` URL comes out at all.
 */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
