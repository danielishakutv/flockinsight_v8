"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Download,
  FileArchive,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Type,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deletePresetAction,
  savePresetAction,
} from "@/app/(app)/studio/actions";
import {
  downloadBlob,
  encodeCanvas,
  loadBitmap,
  previewBitmap,
  renderBranded,
} from "@/lib/image-canvas";
import {
  ASPECT_PRESETS,
  DEFAULT_PRESET,
  SIZE_PRESETS,
  formatSize,
  normalisePreset,
  orientationOf,
  outputName,
  placementKeyFor,
  savingLabel,
  STUDIO_RETENTION_DAYS,
  zipName,
  type OrientationKey,
  type StudioPreset,
} from "@/lib/image-studio";
import { zipFiles } from "@/lib/zip-client";
import { cn } from "@/lib/utils";
import { AnchorGrid } from "@/components/studio/anchor-grid";
import { LogoPanel } from "@/components/studio/logo-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/components/i18n-provider";

export type PresetView = {
  id: string;
  name: string;
  logoUrl: string | null;
  logoMediaId: string | null;
  isDefault: boolean;
  config: StudioPreset;
};

type Photo = {
  id: string;
  file: File;
  width: number;
  height: number;
  /** An object URL for the thumbnail, revoked when the photo is removed. */
  thumb: string;
};

type Done = {
  id: string;
  name: string;
  blob: Blob;
  originalBytes: number;
};

/**
 * How many photographs may be queued at once.
 *
 * Not a technical limit — a guard rail. Each one is decoded to raw pixels to
 * be processed (a 12-megapixel photo is ~48MB in memory), and the finished
 * files are held until they are downloaded. A thousand photos would not fail
 * cleanly; it would make the tab run out of memory with no explanation. A
 * hundred covers a service with room to spare.
 */
const MAX_PHOTOS = 100;

export function StudioClient({
  churchName,
  churchLogoUrl,
  presets,
  canManagePresets,
}: {
  churchName: string;
  churchLogoUrl: string | null;
  presets: PresetView[];
  canManagePresets: boolean;
}) {
  const t = useT();
  const [preset, setPreset] = useState<StudioPreset>(
    () => presets.find((p) => p.isDefault)?.config ?? DEFAULT_PRESET,
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [logo, setLogo] = useState<HTMLCanvasElement | null>(null);
  const [tab, setTab] = useState<OrientationKey>("landscape");
  const [busy, setBusy] = useState<null | { done: number; total: number }>(null);
  const [uploading, setUploading] = useState<null | {
    done: number;
    total: number;
  }>(null);
  const [outputs, setOutputs] = useState<Done[]>([]);
  const [presetName, setPresetName] = useState(
    presets.find((p) => p.isDefault)?.name ?? "Our brand",
  );
  const [saving, startSaving] = useTransition();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  /** Downscaled copies, so dragging a slider does not re-render 12 megapixels. */
  const previewCache = useRef<Map<string, ImageBitmap>>(new Map());

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) {
      toast.error(t("studio.notImages"));
      return;
    }
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length;
      if (room <= 0) {
        toast.error(t("studio.limitReached", { max: MAX_PHOTOS }));
        return current;
      }
      const taken = incoming.slice(0, room);
      if (taken.length < incoming.length) {
        toast.error(t("studio.limitReached", { max: MAX_PHOTOS }));
      }
      return [
        ...current,
        ...taken.map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          // Filled in asynchronously below; 0 until then, which only affects
          // which orientation tab is preselected.
          width: 0,
          height: 0,
          thumb: URL.createObjectURL(file),
        })),
      ];
    });
    setOutputs([]);
  }, [t]);

  /* ---- measure each photo once, so orientation is known ---- */
  useEffect(() => {
    const unmeasured = photos.filter((p) => p.width === 0);
    if (unmeasured.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const photo of unmeasured) {
        try {
          const { bitmap } = await loadBitmap(photo.file);
          const width = bitmap.width;
          const height = bitmap.height;
          bitmap.close?.();
          if (cancelled) return;
          setPhotos((cur) =>
            cur.map((p) => (p.id === photo.id ? { ...p, width, height } : p)),
          );
        } catch {
          // An unreadable file is dropped with a word, not left in the list
          // pretending it will process.
          if (cancelled) return;
          setPhotos((cur) => cur.filter((p) => p.id !== photo.id));
          toast.error(t("studio.unreadable", { name: photo.file.name }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photos, t]);

  /* ---- paste from the clipboard: the fastest route from a phone ---- */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) addFiles(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  /* ---- the live preview ---- */
  const previewSource = photos.find(
    (p) => p.width > 0 && placementKeyFor(p.width, p.height) === tab,
  );

  useEffect(() => {
    const photo = previewSource;
    const canvas = previewRef.current;
    if (!photo || !canvas) return;
    let cancelled = false;

    void (async () => {
      let bitmap = previewCache.current.get(photo.id);
      if (!bitmap) {
        const loaded = await previewBitmap(photo.file);
        if (cancelled) {
          loaded.bitmap.close?.();
          return;
        }
        bitmap = loaded.bitmap;
        previewCache.current.set(photo.id, bitmap);
      }
      try {
        const { canvas: rendered } = renderBranded({ photo: bitmap, logo, preset });
        if (cancelled) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(rendered, 0, 0);
      } catch (e) {
        // A preview that silently fails looks like a broken app. Say it once.
        console.error("[studio] preview failed", e);
        if (!cancelled) toast.error(t("studio.previewFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewSource, logo, preset, t]);

  /* ---- release object URLs and bitmaps on unmount ---- */
  useEffect(() => {
    const cache = previewCache.current;
    return () => {
      for (const b of cache.values()) b.close?.();
      cache.clear();
    };
  }, []);

  function removePhoto(id: string) {
    setPhotos((cur) => {
      const gone = cur.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.thumb);
      previewCache.current.get(id)?.close?.();
      previewCache.current.delete(id);
      return cur.filter((p) => p.id !== id);
    });
    setOutputs((cur) => cur.filter((o) => o.id !== id));
  }

  function clearAll() {
    for (const p of photos) URL.revokeObjectURL(p.thumb);
    for (const b of previewCache.current.values()) b.close?.();
    previewCache.current.clear();
    setPhotos([]);
    setOutputs([]);
  }

  /**
   * Process everything, one photo at a time.
   *
   * Sequential on purpose. Decoding four 12-megapixel photos at once is
   * 200MB of raw pixels and is how a phone kills the tab; one at a time with
   * the bitmap closed immediately keeps the ceiling at a single image. The
   * `await` between photos also lets the browser paint, so the progress count
   * actually moves instead of freezing until the end.
   */
  async function processAll() {
    if (photos.length === 0) return;
    setOutputs([]);
    setBusy({ done: 0, total: photos.length });
    const results: Done[] = [];

    for (const [index, photo] of photos.entries()) {
      try {
        const { bitmap } = await loadBitmap(photo.file);
        const { canvas } = renderBranded({ photo: bitmap, logo, preset });
        bitmap.close?.();
        const blob = await encodeCanvas(canvas, preset.format, preset.quality);
        results.push({
          id: photo.id,
          name: outputName(photo.file.name, preset.format),
          blob,
          originalBytes: photo.file.size,
        });
      } catch {
        toast.error(t("studio.processFailed", { name: photo.file.name }));
      }
      setBusy({ done: index + 1, total: photos.length });
    }

    setBusy(null);
    setOutputs(results);
    if (results.length) {
      const before = results.reduce((n, r) => n + r.originalBytes, 0);
      const after = results.reduce((n, r) => n + r.blob.size, 0);
      toast.success(
        t("studio.ready", {
          n: `${results.length} ${results.length === 1 ? "photo" : "photos"}`,
          saving: savingLabel(before, after),
        }),
      );
    }
  }

  /**
   * Put the finished copies in the media library, for a link.
   *
   * The one thing here that touches the server, and it is opt-in: a church
   * that only wants the files on its phone never uploads anything. What it
   * buys is a shareable link — for a bulletin, a website, a WhatsApp group
   * that will not take an attachment.
   *
   * Uploaded one at a time rather than in parallel: this runs on the same
   * connection that is already slow, and twenty simultaneous uploads on a
   * Nigerian mobile link means twenty timeouts instead of twenty files.
   */
  async function saveToLibrary() {
    if (outputs.length === 0) return;
    setUploading({ done: 0, total: outputs.length });
    let saved = 0;
    let failed = 0;

    for (const [index, out] of outputs.entries()) {
      try {
        const body = new FormData();
        body.append("file", out.blob, out.name);
        body.append("kind", "studio");
        body.append("title", out.name);
        const res = await fetch("/api/media/upload", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as
          | { ok: true }
          | { ok: false; error: string }
          | null;
        if (data?.ok) saved++;
        else {
          failed++;
          // The server's own words — "Not enough storage. You've used…" is
          // actionable; "upload failed" is not.
          if (failed === 1 && data && !data.ok) toast.error(data.error);
        }
      } catch {
        failed++;
      }
      setUploading({ done: index + 1, total: outputs.length });
    }

    setUploading(null);
    if (saved > 0) {
      toast.success(
        t("studio.savedToLibrary", {
          n: `${saved} ${saved === 1 ? "photo" : "photos"}`,
          days: STUDIO_RETENTION_DAYS,
        }),
      );
    }
    if (failed > 0 && saved === 0) {
      toast.error(t("studio.saveFailed"));
    }
  }

  async function downloadZip() {
    if (outputs.length === 0) return;
    const files = await Promise.all(
      outputs.map(async (o) => ({
        name: o.name,
        data: new Uint8Array(await o.blob.arrayBuffer()),
      })),
    );
    const zip = zipFiles(files);
    if (!zip.ok) {
      toast.error(zip.error);
      return;
    }
    downloadBlob(zip.blob, zipName(churchName));
  }

  function savePreset() {
    startSaving(async () => {
      const res = await savePresetAction({
        name: presetName,
        // The logo itself is not saved with the preset — see the note by the
        // button. Only the geometry and the output settings are.
        logoUrl: null,
        logoMediaId: null,
        config: preset,
        makeDefault: true,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("studio.presetSaved"));
    });
  }

  function loadPreset(p: PresetView) {
    setPreset(normalisePreset(p.config));
    setPresetName(p.name);
    toast.success(t("studio.presetLoaded", { name: p.name }));
  }

  function removePreset(p: PresetView) {
    if (!confirm(t("studio.presetDeleteConfirm", { name: p.name }))) return;
    startSaving(async () => {
      const res = await deletePresetAction(p.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("studio.presetDeleted"));
    });
  }

  const place = preset.placement[tab];
  const setPlace = (patch: Partial<typeof place>) =>
    setPreset((p) => ({
      ...p,
      placement: { ...p.placement, [tab]: { ...p.placement[tab], ...patch } },
    }));

  const counts = {
    portrait: photos.filter((p) => p.width > 0 && orientationOf(p.width, p.height) === "portrait").length,
    landscape: photos.filter((p) => p.width > 0 && orientationOf(p.width, p.height) !== "portrait").length,
  };

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------- the photos */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg">{t("studio.photos")}</CardTitle>
            <CardDescription>{t("studio.photosHint")}</CardDescription>
          </div>
          {photos.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <Trash2 /> {t("studio.clear")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
            }}
            className="hover:border-primary/50 rounded-xl border-2 border-dashed p-6 text-center transition-colors"
          >
            <Button onClick={() => fileRef.current?.click()} size="lg">
              <ImagePlus /> {t("studio.addPhotos")}
            </Button>
            <p className="text-muted-foreground mt-2 text-xs">
              {t("studio.dropHint", { max: MAX_PHOTOS })}
            </p>
          </div>

          {photos.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">
                  {t("studio.selected", { n: photos.length })}
                </Badge>
                {counts.landscape > 0 && (
                  <Badge variant="outline">
                    {t("studio.landscapeCount", { n: counts.landscape })}
                  </Badge>
                )}
                {counts.portrait > 0 && (
                  <Badge variant="outline">
                    {t("studio.portraitCount", { n: counts.portrait })}
                  </Badge>
                )}
              </div>
              {/*
                Two columns on the narrowest phone, not three. At 320px three
                columns is a 96px thumbnail carrying a 36px delete button —
                too small to judge a photograph by and fiddly to hit.
              */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                {photos.map((p) => {
                  const out = outputs.find((o) => o.id === p.id);
                  return (
                    <div key={p.id} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.thumb}
                        alt=""
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        aria-label={`Remove ${p.file.name}`}
                        className="bg-background/90 absolute top-1 right-1 grid size-9 place-items-center rounded-full border shadow-sm"
                      >
                        <X className="size-3.5" />
                      </button>
                      {out && (
                        <button
                          type="button"
                          onClick={() => downloadBlob(out.blob, out.name)}
                          className="bg-primary text-primary-foreground absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                        >
                          {formatSize(out.blob.size)} ↓
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------- the logo */}
      <LogoPanel churchLogoUrl={churchLogoUrl} onLogoReady={setLogo} />

      {/* ---------------------------------------------- placement + preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("studio.placementTitle")}</CardTitle>
          <CardDescription>{t("studio.placementHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted inline-flex rounded-full p-1">
            {(["landscape", "portrait"] as OrientationKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors",
                  tab === key
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {key}
                {counts[key] > 0 && (
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {counts[key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
            <div className="space-y-4">
              <AnchorGrid
                label={t("studio.position")}
                value={place.anchor}
                onChange={(anchor) => setPlace({ anchor })}
              />
              <Slider
                id="size"
                label={t("studio.sizeLabel", { n: place.sizePct })}
                min={2}
                max={100}
                value={place.sizePct}
                onChange={(sizePct) => setPlace({ sizePct })}
              />
              <Slider
                id="margin"
                label={t("studio.marginLabel", { n: place.marginPct })}
                min={0}
                max={25}
                value={place.marginPct}
                onChange={(marginPct) => setPlace({ marginPct })}
              />
              <Slider
                id="opacity"
                label={t("studio.strengthLabel", { n: place.opacity })}
                min={10}
                max={100}
                value={place.opacity}
                onChange={(opacity) => setPlace({ opacity })}
              />
            </div>

            <div className="min-w-0">
              <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase">
                {t("studio.preview")}
              </p>
              {previewSource ? (
                <canvas
                  ref={previewRef}
                  className="bg-muted max-h-[420px] w-full rounded-xl border object-contain"
                  style={{ maxWidth: "100%", height: "auto" }}
                />
              ) : (
                <div className="text-muted-foreground bg-muted/40 grid h-48 place-items-center rounded-xl border border-dashed p-4 text-center text-sm">
                  {photos.length === 0
                    ? t("studio.previewEmpty")
                    : t("studio.previewNone")}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------- text */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Type className="size-4" /> {t("studio.textTitle")}
            </CardTitle>
            <CardDescription>{t("studio.textHint")}</CardDescription>
          </div>
          <Switch
            checked={preset.text.enabled}
            onCheckedChange={(enabled) =>
              setPreset((p) => ({ ...p, text: { ...p.text, enabled } }))
            }
            aria-label={t("studio.textToggle")}
          />
        </CardHeader>
        {preset.text.enabled && (
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="overlay-text">{t("studio.textWhat")}</Label>
              <Input
                id="overlay-text"
                value={preset.text.text}
                maxLength={120}
                onChange={(e) =>
                  setPreset((p) => ({
                    ...p,
                    text: { ...p.text, text: e.target.value },
                  }))
                }
                placeholder={t("studio.textPlaceholder")}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  churchName,
                  new Date().toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                  "Sunday Service",
                ].map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    onClick={() =>
                      setPreset((p) => ({
                        ...p,
                        text: {
                          ...p.text,
                          text: [p.text.text, snippet]
                            .filter(Boolean)
                            .join(" · ")
                            .slice(0, 120),
                        },
                      }))
                    }
                    className="bg-muted hover:bg-muted/70 rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    + {snippet}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
              <AnchorGrid
                label={t("studio.textPosition")}
                value={preset.text.anchor}
                onChange={(anchor) =>
                  setPreset((p) => ({ ...p, text: { ...p.text, anchor } }))
                }
              />
              <div className="space-y-4">
                <Slider
                  id="text-size"
                  label={t("studio.textSize", { n: preset.text.sizePct })}
                  min={2}
                  max={14}
                  value={preset.text.sizePct}
                  onChange={(sizePct) =>
                    setPreset((p) => ({ ...p, text: { ...p.text, sizePct } }))
                  }
                />
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="text-colour" className="text-xs">
                      {t("studio.colour")}
                    </Label>
                    <input
                      id="text-colour"
                      type="color"
                      value={preset.text.color}
                      onChange={(e) =>
                        setPreset((p) => ({
                          ...p,
                          text: { ...p.text, color: e.target.value },
                        }))
                      }
                      className="size-9 cursor-pointer rounded border bg-transparent"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="backdrop"
                      checked={preset.text.backdrop}
                      onCheckedChange={(backdrop) =>
                        setPreset((p) => ({ ...p, text: { ...p.text, backdrop } }))
                      }
                    />
                    <Label htmlFor="backdrop" className="text-xs">
                      {t("studio.backdrop")}
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ---------------------------------------------- output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("studio.outputTitle")}</CardTitle>
          <CardDescription>{t("studio.outputHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="size">{t("studio.longestEdge")}</Label>
            <Select
              value={preset.size}
              onValueChange={(size) =>
                setPreset((p) => ({ ...p, size: size as StudioPreset["size"] }))
              }
            >
              <SelectTrigger id="size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_PRESETS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aspect">{t("studio.shape")}</Label>
            <Select
              value={preset.aspect}
              onValueChange={(aspect) =>
                setPreset((p) => ({
                  ...p,
                  aspect: aspect as StudioPreset["aspect"],
                }))
              }
            >
              <SelectTrigger id="aspect" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_PRESETS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="format">{t("studio.fileType")}</Label>
            <Select
              value={preset.format}
              onValueChange={(format) =>
                setPreset((p) => ({
                  ...p,
                  format: format as StudioPreset["format"],
                }))
              }
            >
              <SelectTrigger id="format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image/webp">{t("studio.webp")}</SelectItem>
                <SelectItem value="image/jpeg">{t("studio.jpeg")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Slider
            id="quality"
            label={t("studio.qualityLabel", { n: preset.quality })}
            min={50}
            max={100}
            value={preset.quality}
            onChange={(quality) => setPreset((p) => ({ ...p, quality }))}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------- presets */}
      {canManagePresets && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("studio.presetTitle")}</CardTitle>
            <CardDescription>{t("studio.presetHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-1.5">
                <Label htmlFor="preset-name">{t("studio.presetName")}</Label>
                <Input
                  id="preset-name"
                  value={presetName}
                  maxLength={60}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder={t("studio.presetNamePlaceholder")}
                />
              </div>
              <Button onClick={savePreset} disabled={saving || !presetName.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {t("studio.save")}
              </Button>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {presets.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1 rounded-full border pr-1 pl-3 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => loadPreset(p)}
                      className="py-1.5 font-medium"
                    >
                      {p.name}
                      {p.isDefault && (
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {t("studio.presetDefault")}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePreset(p)}
                      aria-label={`Delete ${p.name}`}
                      className="hover:bg-muted grid size-11 place-items-center rounded-full lg:size-7"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------- do it */}
      <div className="bg-background/95 sticky bottom-20 z-20 rounded-2xl border p-3 shadow-lg backdrop-blur lg:bottom-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            onClick={() => void processAll()}
            disabled={!!busy || photos.length === 0}
            className="flex-1 sm:flex-none"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy
              ? t("studio.working", { done: busy.done, total: busy.total })
              : photos.length === 0
                ? t("studio.processEmpty")
                : photos.length === 1
                  ? t("studio.processOne")
                  : t("studio.process", { n: photos.length })}
          </Button>

          {outputs.length > 0 && !busy && (
            <>
              <Button variant="outline" size="lg" onClick={() => void downloadZip()}>
                <FileArchive /> {t("studio.downloadAll", { n: outputs.length })}
              </Button>
              {outputs.length === 1 && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => downloadBlob(outputs[0].blob, outputs[0].name)}
                >
                  <Download /> {outputs[0].name}
                </Button>
              )}
              {canManagePresets && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => void saveToLibrary()}
                  disabled={!!uploading}
                  title={`Saved copies are removed after ${STUDIO_RETENTION_DAYS} days`}
                >
                  {uploading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <UploadCloud />
                  )}
                  {uploading
                    ? t("studio.saving", {
                        done: uploading.done,
                        total: uploading.total,
                      })
                    : t("studio.saveToLibrary")}
                </Button>
              )}
            </>
          )}
        </div>
        {outputs.length > 0 && !busy && canManagePresets && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("studio.retentionNote", { days: STUDIO_RETENTION_DAYS })}
          </p>
        )}
        {busy && (
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A labelled range input — the control this screen is mostly made of. */
function Slider({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // h-6 rather than the browser default: a 4px-tall track is unusable
        // with a thumb, and this screen is mostly used on a phone.
        className="accent-primary h-6 w-full"
      />
    </div>
  );
}
