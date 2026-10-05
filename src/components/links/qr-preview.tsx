"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QrSymbol } from "@/lib/qr/encode";
import type { QrDesign } from "@/lib/qr/design";
import { renderSvg } from "@/lib/qr/render";
import { buildSimple, type AutoFixChange, type SimpleChoice } from "@/lib/qr/simple";
import { describeSample, sampleRendered } from "@/lib/qr/verify-render";
import { PNG_SIZES, copyPng, downloadPng, downloadSvg } from "@/lib/qr/download";
import { useT } from "@/components/i18n-provider";

/**
 * The code, where it goes, and what we had to adjust.
 *
 * NO FINDINGS PANEL ANY MORE, and that is the point of the change rather than
 * a casualty of it. The panel listed what was wrong with a design and asked
 * the church to put it right; `autoFix` puts it right instead, so there is
 * nothing left to list. What replaces it is the two things a church does want:
 * the destination in plain text with a link to open it, because "does it
 * actually go where I typed" is the only question that matters; and one line
 * per adjustment, so a correction is never silent.
 *
 * "Read it back" stays. It is the one check no arithmetic can stand in for —
 * it rasterises the finished picture and samples every module the way a camera
 * does — and it is now a reassurance rather than a gate.
 */

export type BuildState =
  | { ok: true; symbol: QrSymbol; design: QrDesign; svg: string; changes: AutoFixChange[] }
  | { ok: false; error: string };

/** Build, fix and render in one memo, so a change costs one pass. */
export function useQrState(text: string, choice: SimpleChoice, title: string): BuildState {
  return useMemo(() => {
    const built = buildSimple(text, choice);
    if (!built.ok) return { ok: false, error: built.error };
    return {
      ok: true,
      symbol: built.symbol,
      design: built.design,
      svg: renderSvg(built.symbol, built.design, { title: title || "QR code" }),
      changes: built.changes,
    };
  }, [text, choice, title]);
}

export function QrPreview({
  state,
  title,
  destination,
  onDownloaded,
}: {
  state: BuildState;
  title: string;
  /** Exactly what scanning it opens. Shown, because that is the whole job. */
  destination: string;
  onDownloaded?: () => void;
}) {
  const t = useT();
  const [pngSize, setPngSize] = useState(1024);
  const [exporting, setExporting] = useState(false);
  const [checking, startCheck] = useTransition();
  const [checked, setChecked] = useState<{ good: boolean; text: string } | null>(null);

  if (!state.ok) {
    return (
      <div className="bg-card rounded-2xl border p-5">
        <div className="bg-muted/60 flex aspect-square w-full items-center justify-center rounded-xl">
          <ImageIcon className="text-muted-foreground/50 size-10" />
        </div>
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">{state.error}</p>
      </div>
    );
  }

  const { symbol, design, svg, changes } = state;
  const opensUrl = /^https?:\/\//i.test(destination);

  async function exportPng() {
    setExporting(true);
    const res = await downloadPng(symbol, design, title || "qr-code", pngSize);
    setExporting(false);
    if (res.ok) onDownloaded?.();
    else toast.error(res.error);
  }

  function exportSvg() {
    const res = downloadSvg(symbol, design, title || "qr-code");
    if (res.ok) onDownloaded?.();
    else toast.error(res.error);
  }

  async function copy() {
    const res = await copyPng(symbol, design);
    if (res.ok) toast.success(t("links.copiedPasteItStraightInto"));
    else toast.error(res.error);
  }

  function readItBack() {
    startCheck(async () => {
      const result = await sampleRendered(symbol, design, svg);
      const described = describeSample(result);
      setChecked({ good: described.level === "note", text: described.detail });
      if (described.level !== "note") toast.error(described.title);
    });
  }

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------- the picture */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="overflow-hidden rounded-xl border">
          <div
            className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            /*
             * WHY THIS IS SAFE. `svg` comes from `renderSvg`, which takes a
             * module grid and a design and nothing else. Every string a person
             * typed — the caption, the letters, the title — is XML-escaped by
             * `esc()` on the way in; every colour has been through
             * `isHexColor`; and the only free-text field, an image URL, is
             * restricted by `normaliseDesign` to http, https and a path on this
             * site. There is no route by which input becomes markup here.
             */
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <Check className="size-3.5" />
            Ready to print
          </Badge>
          <Badge variant="secondary">
            {symbol.size}×{symbol.size} squares
          </Badge>
        </div>
      </div>

      {/* ---------------------------------------------- where it goes */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="text-sm font-semibold">{t("links.scanningItOpens")}</h3>
        <p className="text-muted-foreground mt-1 text-xs break-all">{destination}</p>
        {opensUrl && (
          <Button asChild variant="outline" size="sm" className="mt-2.5 min-h-11">
            <a href={destination} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Open it, to check
            </a>
          </Button>
        )}
      </div>

      {/* ---------------------------------------------- what we adjusted */}
      {changes.length > 0 && (
        <div className="border-border bg-muted/40 rounded-2xl border p-4 sm:p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Wand2 className="size-4" />
            What we adjusted so it scans
          </h3>
          <ul className="mt-2 space-y-1.5">
            {changes.map((change) => (
              <li key={change.key} className="text-muted-foreground text-xs leading-relaxed">
                {change.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------------------------------------- downloads */}
      <div className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={exportPng} disabled={exporting} className="min-h-11">
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            PNG
          </Button>
          <Button onClick={exportSvg} variant="outline" className="min-h-11">
            <Download className="size-4" />
            SVG
          </Button>
          <Button onClick={copy} variant="outline" className="min-h-11">
            <Copy className="size-4" />
            Copy
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PNG_SIZES.map((size) => (
            <button
              key={size.px}
              type="button"
              onClick={() => setPngSize(size.px)}
              className={cn(
                "min-h-9 rounded-lg border px-2.5 text-xs font-medium transition",
                pngSize === size.px
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {size.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {PNG_SIZES.find((s) => s.px === pngSize)?.use}. For anything going to a printer,
          send the SVG — it prints crisply at any size.
        </p>
      </div>

      {/* ---------------------------------------------- read it back */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("links.checkItLikeACamera")}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              Draws the finished picture and reads every square back out of the pixels.
              Optional — the code is already built to scan.
            </p>
          </div>
          <Button
            onClick={readItBack}
            disabled={checking}
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0"
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ScanLine className="size-4" />
            )}
            Read it back
          </Button>
        </div>
        {checked && (
          <p
            className={cn(
              "mt-3 rounded-xl border p-3 text-xs leading-relaxed",
              checked.good
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            {checked.text}
          </p>
        )}
      </div>
    </div>
  );
}
