"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Info,
  Loader2,
  ScanLine,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { encodeQr, type QrSymbol } from "@/lib/qr/encode";
import { payloadText, type QrPayload } from "@/lib/qr/payload";
import { structuralMinVersion, type QrDesign } from "@/lib/qr/design";
import { layoutFor, renderSvg } from "@/lib/qr/render";
import { n } from "@/lib/qr/shapes";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_TONE,
  FINDING_TONE,
  analyse,
  confidenceOf,
  type Analysis,
  type FindingLevel,
} from "@/lib/qr/verify";
import { describeSample, sampleRendered, type SampleResult } from "@/lib/qr/verify-render";
import { PNG_SIZES, copyPng, downloadPng, downloadSvg } from "@/lib/qr/download";
import { useT } from "@/components/i18n-provider";

/**
 * The code, and the truth about it.
 *
 * The preview and the checks are one component on purpose. Everything that
 * makes a decorative QR code fail is invisible in a picture of it — a logo a
 * fraction too big, a brand colour a shade too light, a photograph that is
 * dark in one corner — so a preview shown on its own is a preview that lies by
 * omission. The badge and the findings sit against the picture they describe.
 */

export type EncodeState =
  | { ok: true; symbol: QrSymbol; analysis: Analysis; svg: string; text: string }
  | { ok: false; error: string };

/**
 * Encode, render and analyse in one memo.
 *
 * Exported because the designer needs the same result for its own header and
 * its save button, and doing it twice would be two encodes per keystroke on a
 * phone. The version floor from `structuralMinVersion` is applied HERE rather
 * than in the controls, so it holds however the design arrived — including a
 * design opened from a row saved before that floor existed.
 */
export function useQrState(payload: QrPayload, design: QrDesign, title: string): EncodeState {
  return useMemo(() => {
    const text = payloadText(payload);
    if (!text.ok) return { ok: false, error: text.error };

    const floor = Math.max(design.minVersion, structuralMinVersion(design));
    const encoded = encodeQr(text.text, { ecLevel: design.ecLevel, minVersion: floor });
    if (!encoded.ok) return { ok: false, error: encoded.error };

    return {
      ok: true,
      symbol: encoded.symbol,
      analysis: analyse(encoded.symbol, design),
      svg: renderSvg(encoded.symbol, design, { title: title || "QR code" }),
      text: text.text,
    };
  }, [payload, design, title]);
}

export function QrPreview({
  state,
  design,
  title,
  onDownloaded,
  compact = false,
}: {
  state: EncodeState;
  design: QrDesign;
  title: string;
  /** Called after a successful export, so a caller can count it. */
  onDownloaded?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const [sample, setSample] = useState<SampleResult | null>(null);
  const [checking, startCheck] = useTransition();
  const [pngSize, setPngSize] = useState<number>(1024);
  const [exporting, setExporting] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  if (!state.ok) {
    return (
      <div className="bg-card rounded-2xl border p-6">
        <div className="bg-muted/60 flex aspect-square w-full items-center justify-center rounded-xl">
          <ImageIcon className="text-muted-foreground/50 size-10" />
        </div>
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">{state.error}</p>
      </div>
    );
  }

  const { symbol, analysis, svg } = state;
  const confidence = confidenceOf(analysis);

  function runCheck() {
    startCheck(async () => {
      const result = await sampleRendered(symbol, design, svg);
      setSample(result);
      setShowOverlay(true);
      if (!result.ok) toast.error(result.error);
    });
  }

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

  const described = sample ? describeSample(sample) : null;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------- the picture */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <div className="relative">
          {/*
            A checkerboard behind it, so a transparent background looks
            transparent rather than looking white and then surprising somebody
            when they put it on a coloured flyer.
          */}
          <div
            className="overflow-hidden rounded-xl border"
            style={{
              backgroundImage:
                "linear-gradient(45deg, rgba(120,120,120,.12) 25%, transparent 25%, transparent 75%, rgba(120,120,120,.12) 75%), linear-gradient(45deg, rgba(120,120,120,.12) 25%, transparent 25%, transparent 75%, rgba(120,120,120,.12) 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 8px 8px",
            }}
          >
            <div
              className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              /*
               * WHY THIS IS SAFE, since the name invites the question.
               *
               * `svg` is built by `renderSvg` from two inputs and nothing else:
               * a QR symbol (a grid of bits) and a design. Every string a person
               * typed — a caption, a monogram, the letters, the title — is
               * XML-escaped by `esc()` on the way in, so none of them can close
               * an attribute or open a tag. Every colour has been through
               * `isHexColor`. The only free-text field is an image URL, and
               * `normaliseDesign` now accepts nothing but http, https and a path
               * on this site. There is no path by which a church's input becomes
               * markup here.
               *
               * The alternative — an <img> with a data URL — would cost the
               * scannability check, which needs to read the modules back out of
               * the rendered picture, and the live preview's responsiveness.
               */
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>

          {sample?.ok && sample.wrong.length > 0 && showOverlay && (
            <WrongModuleOverlay symbol={symbol} design={design} wrong={sample.wrong} />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge className={cn("gap-1", CONFIDENCE_TONE[confidence])}>
            {confidence === "blocked" ? (
              <XCircle className="size-3.5" />
            ) : confidence === "screen-only" ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
            {CONFIDENCE_LABEL[confidence]}
          </Badge>
          <Badge variant="secondary">
            {symbol.size}×{symbol.size} · version {symbol.version} · {symbol.ecLevel}
          </Badge>
          {analysis.metrics.spoiled > 0 && (
            <Badge variant="secondary">
              {analysis.metrics.headroom} of {analysis.metrics.correctable} codewords spare
            </Badge>
          )}
        </div>
      </div>

      {/* ---------------------------------------------- downloads */}
      {!compact && (
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
                title={size.use}
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
            {PNG_SIZES.find((s) => s.px === pngSize)?.use}. For anything that goes to a
            printer, send the SVG — it has no resolution to get wrong, and the file is
            smaller.
          </p>
        </div>
      )}

      {/* ---------------------------------------------- the checks */}
      <div className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t("links.willItScan")}</h3>
          <Button
            onClick={runCheck}
            disabled={checking}
            variant="outline"
            size="sm"
            className="min-h-11"
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ScanLine className="size-4" />
            )}
            Read it back
          </Button>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          The checks below are worked out from the design. “Read it back” does something
          different and stronger: it draws the finished picture, samples every module the
          way a camera does, and compares what came back against what was encoded. It is
          the only way to judge a photograph.
        </p>

        {described && sample && (
          <Finding
            level={described.level}
            title={described.title}
            detail={described.detail}
            action={
              sample.ok && sample.wrong.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowOverlay((v) => !v)}
                  className="text-primary mt-1.5 text-xs font-medium hover:underline"
                >
                  {showOverlay ? "Hide" : "Show"} the {sample.wrong.length} modules that
                  read wrong
                </button>
              ) : null
            }
          />
        )}

        {analysis.findings.length === 0 && !described && (
          <div className="border-border bg-muted/40 rounded-xl border p-3">
            <p className="text-sm font-medium">{t("links.nothingToFlag")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              Good contrast, a full quiet zone, and none of the error correction spent on
              decoration. {analysis.metrics.correctable} codewords of damage can be
              repaired, which is what survives a crease or a thumb over the corner.
            </p>
          </div>
        )}

        {analysis.findings.map((f) => (
          <Finding key={f.key} level={f.level} title={f.title} detail={f.detail} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * One finding
 * ========================================================== */

function Finding({
  level,
  title,
  detail,
  action,
}: {
  level: FindingLevel;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const Icon = level === "blocker" ? ShieldAlert : level === "warning" ? AlertTriangle : Info;
  return (
    <div className={cn("rounded-xl border p-3", FINDING_TONE[level])}>
      <div className="flex gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            level === "blocker"
              ? "text-rose-600 dark:text-rose-400"
              : level === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{detail}</p>
          {action}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Where it read wrong
 * ========================================================== */

/**
 * The modules that came back different, marked on the code.
 *
 * The number on its own ("187 modules read wrong") says there is a problem.
 * The map says WHERE, and where is the diagnosis: a ring around the middle is
 * the logo, a drift across one corner is the photograph behind it, a scatter
 * through the whole field is contrast. Overlaid in the same module coordinates
 * as the code itself, so it lines up exactly.
 */
function WrongModuleOverlay({
  symbol,
  design,
  wrong,
}: {
  symbol: QrSymbol;
  design: QrDesign;
  wrong: { x: number; y: number }[];
}) {
  const box = layoutFor(symbol, design);
  return (
    <svg
      viewBox={`0 0 ${n(box.width)} ${n(box.height)}`}
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden
    >
      {wrong.map((m) => (
        <rect
          key={`${m.x}-${m.y}`}
          x={box.offsetX + m.x}
          y={box.offsetY + m.y}
          width={1}
          height={1}
          fill="rgb(244 63 94 / 0.55)"
          stroke="rgb(190 18 60)"
          strokeWidth={0.08}
        />
      ))}
    </svg>
  );
}
