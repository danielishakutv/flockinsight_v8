/**
 * Turning a code into a file, on the device.
 *
 * Nothing here touches the server. A QR code is a few kilobytes of markup that
 * the browser already has, and rasterising it is a canvas operation — sending
 * it up to be rendered and back down would cost the church bandwidth on a
 * Nigerian mobile connection to receive something it was already holding, and
 * cost us CPU on a box that has been taken down by resource starvation once
 * already. Same reasoning as the photo studio; see lib/image-studio.ts.
 */

import { renderSvg, svgDataUrl } from "@/lib/qr/render";
import type { QrDesign } from "@/lib/qr/design";
import type { QrSymbol } from "@/lib/qr/encode";

/** Sizes offered for a PNG, with what each is actually for. */
export const PNG_SIZES = [
  { px: 512, label: "512px", use: "WhatsApp, a slide, a social post" },
  { px: 1024, label: "1024px", use: "A4 flyer, a bulletin" },
  { px: 2048, label: "2048px", use: "A poster, a banner" },
  { px: 4096, label: "4096px", use: "Large-format print" },
] as const;

/**
 * A filename that says what it is and will sort sensibly in a folder.
 *
 * Date first, because a church ends up with twenty of these in Downloads and
 * "what is qr-code (7).png" is a question nobody can answer.
 */
export function qrFileName(title: string, extension: string, size?: number): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "qr-code";
  return size ? `${date}-${slug}-${size}.${extension}` : `${date}-${slug}.${extension}`;
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next turn: revoking immediately cancels the download in
  // Safari, which starts it asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ExportResult = { ok: true } | { ok: false; error: string };

/** The SVG itself — the one to send to a printer. */
export function downloadSvg(
  symbol: QrSymbol,
  design: QrDesign,
  title: string,
): ExportResult {
  try {
    const svg = renderSvg(symbol, design, { pixelSize: 1024, title });
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      qrFileName(title, "svg"),
    );
    return { ok: true };
  } catch (error) {
    console.error("[qr] downloadSvg failed", error);
    return {
      ok: false,
      error: "The file could not be built. Try reloading the page.",
    };
  }
}

/**
 * A PNG at a chosen width.
 *
 * WHY THIS CAN FAIL WHERE THE SVG CANNOT. Rasterising goes through a canvas,
 * and a canvas holding an image from a host that did not send CORS headers is
 * "tainted" — the browser then refuses to let the pixels out, so `toBlob`
 * throws. That is a property of where the image is hosted, not of the design,
 * and the SVG download is unaffected. So this says exactly that instead of
 * failing with "something went wrong", which would send somebody looking at
 * their design for a fault that is not in it.
 */
export async function downloadPng(
  symbol: QrSymbol,
  design: QrDesign,
  title: string,
  pixelSize: number,
): Promise<ExportResult> {
  const svg = renderSvg(symbol, design, { pixelSize, title });

  let image: HTMLImageElement;
  try {
    image = await loadImage(svgDataUrl(svg));
  } catch {
    return {
      ok: false,
      error:
        "One of the images in the design would not load, so the PNG could not be made. The SVG download does not need to load it and will still work.",
    };
  }

  const width = pixelSize;
  const height = Math.round(
    (pixelSize * (image.naturalHeight || 1)) / (image.naturalWidth || 1),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      ok: false,
      error: "This browser would not give us a canvas, so a PNG cannot be made here. The SVG download will still work.",
    };
  }

  /*
   * A transparent background stays transparent in the PNG, which is what a
   * designer wants. Nothing is painted underneath, so the one thing to be
   * careful of is NOT painting white by habit.
   */
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });

  if (!blob) {
    return {
      ok: false,
      error:
        "The PNG could not be made, because an image in the design is served from a host that will not let a browser read it back. Download the SVG instead — it keeps the image as a link and prints at any size.",
    };
  }

  downloadBlob(blob, qrFileName(title, "png", pixelSize));
  return { ok: true };
}

/** Put the PNG on the clipboard, for pasting straight into a message. */
export async function copyPng(
  symbol: QrSymbol,
  design: QrDesign,
  pixelSize = 1024,
): Promise<ExportResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return {
      ok: false,
      error: "This browser cannot copy an image. Download it instead.",
    };
  }

  const svg = renderSvg(symbol, design, { pixelSize });
  try {
    const image = await loadImage(svgDataUrl(svg));
    const canvas = document.createElement("canvas");
    canvas.width = pixelSize;
    canvas.height = Math.round(
      (pixelSize * (image.naturalHeight || 1)) / (image.naturalWidth || 1),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // White underneath, unlike the download: a transparent PNG pasted into a
    // document with a dark theme is an invisible QR code.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
    if (!blob) throw new Error("tainted");

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { ok: true };
  } catch (error) {
    console.error("[qr] copyPng failed", error);
    return {
      ok: false,
      error: "The image could not be copied. Download it instead.",
    };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image failed to load"));
    image.src = src;
  });
}
