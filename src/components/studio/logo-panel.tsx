"use client";

import { useEffect, useRef, useState } from "react";
import { Crop, Eraser, ImagePlus, RotateCcw, Scissors } from "lucide-react";
import { toast } from "sonner";
import {
  cropCanvas,
  loadBitmap,
  removeFlatBackground,
  trimTransparent,
} from "@/lib/image-canvas";
import { clamp } from "@/lib/image-studio";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * Preparing the mark that goes on every photo.
 *
 * Four things a church logo almost always needs, in the order it needs them:
 * it arrives as a JPEG on white, it has half an inch of blank space around it,
 * it is the wrong crop, and it is too strong at full opacity. The first three
 * are here; opacity is next to the position, where it is judged against a
 * photograph.
 *
 * The whole panel works on a canvas and hands the parent the finished canvas,
 * so the rest of the studio never thinks about any of this.
 */
export function LogoPanel({
  churchLogoUrl,
  onLogoReady,
}: {
  /** The logo already in Settings, offered as a shortcut. */
  churchLogoUrl: string | null;
  /** Null when cleared. */
  onLogoReady: (logo: HTMLCanvasElement | null) => void;
}) {
  const t = useT();
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** The logo exactly as it arrived — every edit re-derives from this. */
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const [has, setHas] = useState(false);
  const [removeBg, setRemoveBg] = useState(true);
  const [tolerance, setTolerance] = useState(24);
  const [trim, setTrim] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState<null | {
    x: number;
    y: number;
    w: number;
    h: number;
  }>(null);
  const [drag, setDrag] = useState<null | { x: number; y: number }>(null);

  /*
   * Every setting re-derives from the ORIGINAL, never from the last result.
   *
   * Applying background removal to an already-processed canvas and then
   * raising the tolerance would eat more of the logo each time, with no way
   * back short of re-uploading. Keeping the source and recomputing makes every
   * control reversible.
   */
  useEffect(() => {
    const source = originalRef.current;
    const canvas = previewRef.current;
    if (!source || !canvas) return;

    let work: HTMLCanvasElement = source;
    if (cropRect && cropRect.w > 4 && cropRect.h > 4) {
      work = cropCanvas(work, {
        x: cropRect.x,
        y: cropRect.y,
        width: cropRect.w,
        height: cropRect.h,
      });
    }
    if (removeBg) work = removeFlatBackground(work, tolerance);
    if (trim) work = trimTransparent(work);

    canvas.width = work.width;
    canvas.height = work.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, 0, 0);
    onLogoReady(work);
    // onLogoReady is a parent callback and intentionally not a dependency: it
    // changes identity on every parent render, which would loop this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removeBg, tolerance, trim, cropRect, has]);

  async function take(blob: Blob) {
    try {
      const { bitmap } = await loadBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      originalRef.current = canvas;
      setCropRect(null);
      setCropping(false);
      setHas(true);
    } catch {
      toast.error(t("studio.logoUnreadable"));
    }
  }

  async function useChurchLogo() {
    if (!churchLogoUrl) return;
    try {
      /*
       * Fetched rather than drawn from an <img>.
       *
       * A remote image drawn onto a canvas taints it, and every subsequent
       * getImageData throws a security error — which would break background
       * removal with a message about nothing a church could act on. A fetch
       * either succeeds and gives us real bytes, or fails here where it can be
       * explained.
       */
      const res = await fetch(churchLogoUrl, { mode: "cors" });
      if (!res.ok) throw new Error(String(res.status));
      await take(await res.blob());
    } catch {
      toast.error(t("studio.churchLogoFailed"));
    }
  }

  function clear() {
    originalRef.current = null;
    setHas(false);
    setCropRect(null);
    setCropping(false);
    onLogoReady(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /* ---- drag a crop box over the preview, in source pixels ---- */

  function pointToSource(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = previewRef.current;
    const source = originalRef.current;
    if (!canvas || !source) return null;
    const rect = canvas.getBoundingClientRect();
    // The preview is drawn at the PROCESSED size but the crop applies to the
    // original, so the ratio is taken from the source rather than the canvas.
    const scaleX = source.width / rect.width;
    const scaleY = source.height / rect.height;
    return {
      x: clamp((e.clientX - rect.left) * scaleX, 0, source.width),
      y: clamp((e.clientY - rect.top) * scaleY, 0, source.height),
    };
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-base font-semibold">{t("studio.logoTitle")}</Label>
          {has && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <RotateCcw /> {t("studio.startAgain")}
            </Button>
          )}
        </div>

        {!has ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => fileRef.current?.click()}>
                <ImagePlus /> {t("studio.uploadLogo")}
              </Button>
              {churchLogoUrl && (
                <Button variant="outline" onClick={useChurchLogo}>
                  {t("studio.useChurchLogo")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("studio.logoHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/*
              A chequerboard behind the preview. Transparency over white looks
              identical to white, so without it "remove background" appears to
              do nothing at all.
            */}
            <div
              className="relative inline-block max-w-full overflow-hidden rounded-xl border"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0,0 8px,8px -8px,-8px 0px",
              }}
            >
              <canvas
                ref={previewRef}
                className={cn(
                  "block max-h-48 w-auto max-w-full touch-none",
                  cropping && "cursor-crosshair",
                )}
                onPointerDown={(e) => {
                  if (!cropping) return;
                  const p = pointToSource(e);
                  if (!p) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag(p);
                  setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
                }}
                onPointerMove={(e) => {
                  if (!cropping || !drag) return;
                  const p = pointToSource(e);
                  if (!p) return;
                  setCropRect({
                    x: Math.min(drag.x, p.x),
                    y: Math.min(drag.y, p.y),
                    w: Math.abs(p.x - drag.x),
                    h: Math.abs(p.y - drag.y),
                  });
                }}
                onPointerUp={() => {
                  setDrag(null);
                  setCropping(false);
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={removeBg ? "default" : "outline"}
                size="sm"
                onClick={() => setRemoveBg((v) => !v)}
              >
                <Eraser />{" "}
                {removeBg
                  ? t("studio.backgroundRemoved")
                  : t("studio.removeBackground")}
              </Button>
              <Button
                variant={trim ? "default" : "outline"}
                size="sm"
                onClick={() => setTrim((v) => !v)}
              >
                <Scissors />{" "}
                {trim ? t("studio.edgesTrimmed") : t("studio.trimEdges")}
              </Button>
              <Button
                variant={cropping ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  setCropping((v) => !v);
                  if (cropRect) setCropRect(null);
                }}
              >
                <Crop />{" "}
                {cropping
                  ? t("studio.cropDragging")
                  : cropRect
                    ? t("studio.clearCrop")
                    : t("studio.crop")}
              </Button>
            </div>

            {removeBg && (
              <div className="space-y-1.5">
                <Label htmlFor="tol" className="text-xs">
                  {t("studio.toleranceLabel", { n: tolerance })}
                </Label>
                <input
                  id="tol"
                  type="range"
                  min={4}
                  max={90}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="accent-primary h-6 w-full max-w-xs"
                />
                <p className="text-muted-foreground text-xs">
                  {t("studio.toleranceHint")}
                </p>
              </div>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void take(file);
          }}
        />
      </CardContent>
    </Card>
  );
}
