"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Resize + re-encode an image to WebP in the browser before upload. This keeps
 * uploads tiny on slow connections and standardises the stored format.
 */
async function compress(
  file: File,
  maxDim: number,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not process image"))),
      "image/webp",
      quality,
    ),
  );
}

/** Compress (client) then upload to /api/media. Returns the stored URL. */
export async function uploadImage(
  file: File,
  kind: "logo" | "cover" | "photo",
  maxDim: number,
): Promise<string> {
  const blob = await compress(file, maxDim);
  const fd = new FormData();
  fd.append("file", blob, "image.webp");
  fd.append("kind", kind);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const data = (await res.json().catch(() => null)) as
    | { ok: true; url: string }
    | { ok: false; error: string }
    | null;
  if (!data || !data.ok) throw new Error(data?.error || "Upload failed");
  return data.url;
}

export function ImageUpload({
  value,
  onChange,
  kind,
  maxDim,
  label,
  aspect = "square",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  kind: "logo" | "cover";
  maxDim: number;
  label: string;
  aspect?: "square" | "wide";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadImage(file, kind, maxDim);
      onChange(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "bg-muted relative grid shrink-0 place-items-center overflow-hidden rounded-xl border",
            aspect === "square" ? "size-20" : "h-20 w-36",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <ImagePlus className="text-muted-foreground size-6" />
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {value ? "Change" : "Upload"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onChange(null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-4" /> Remove
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

export function GalleryUpload({
  photos,
  onChange,
  max = 12,
}: {
  photos: { url: string; caption?: string }[];
  onChange: (next: { url: string; caption?: string }[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const room = max - photos.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const uploaded: { url: string }[] = [];
      for (const f of picked) {
        const url = await uploadImage(f, "photo", 1600);
        uploaded.push({ url });
      }
      onChange([...photos, ...uploaded]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Photos ({photos.length}/{max})</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || photos.length >= max}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Add photos
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p, i) => (
          <div
            key={p.url}
            className="bg-muted group relative aspect-square overflow-hidden rounded-lg border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Remove photo"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
    </div>
  );
}
