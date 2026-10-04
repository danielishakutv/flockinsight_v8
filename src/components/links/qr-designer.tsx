"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DESIGN,
  PRESETS,
  brandPreset,
  initialsOf,
  normaliseDesign,
  structuralMinVersion,
  type QrDesign,
} from "@/lib/qr/design";
import { blankPayload, type QrPayload } from "@/lib/qr/payload";
import { renderSvg } from "@/lib/qr/render";
import { encodeQr } from "@/lib/qr/encode";
import { qrTargetUrl } from "@/lib/links-shared";
import { QrControls } from "@/components/links/qr-controls";
import { QrPayloadForm, type LinkChoice } from "@/components/links/qr-payload-form";
import { QrPreview, useQrState } from "@/components/links/qr-preview";
import { deleteCode, noteCodeDownload, saveCode } from "@/app/(app)/links/actions";
import { useT } from "@/components/i18n-provider";

/**
 * The designer.
 *
 * ONE PIECE OF STATE, and everything else derived. The payload, the design and
 * the title are the only things held; the encoded symbol, the markup and the
 * scannability analysis are all recomputed from them on every change (one memo,
 * in `useQrState`). That is what makes every control two-way: there is no
 * rendered result to get out of step with the settings, because the result is
 * not stored anywhere. Same approach as the photo studio.
 *
 * THE DYNAMIC CASE IS NOT A SETTING. When the kind is `link`, the payload's URL
 * is DERIVED from the chosen short link rather than typed — so a code cannot be
 * saved as "dynamic" while pointing at a URL somebody edited by hand, and the
 * `?s=qr` marker that separates a scan from a click is never left off.
 */

export type DesignerProps = {
  codeId: string | null;
  initialTitle: string;
  initialPayload: QrPayload;
  initialDesign: QrDesign;
  initialLinkId: string | null;
  links: LinkChoice[];
  baseUrl: string;
  churchName: string;
  churchLogo: string | null;
  brandColor: string | null;
  canUseShortLinks: boolean;
  canManage: boolean;
};

type Tab = "points" | "look" | "checks";

export function QrDesigner(props: DesignerProps) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [payload, setPayload] = useState<QrPayload>(props.initialPayload);
  const [design, setDesign] = useState<QrDesign>(props.initialDesign);
  const [linkId, setLinkId] = useState<string | null>(props.initialLinkId);
  const [tab, setTab] = useState<Tab>("points");
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const initials = useMemo(() => initialsOf(props.churchName), [props.churchName]);

  /*
   * The payload the code actually encodes.
   *
   * For a dynamic code this is the short link plus its scan marker, built here
   * from the chosen link — never from a field. The payload in state still holds
   * the kind, which is what gets stored, so re-opening the design restores the
   * right form.
   */
  const effectivePayload = useMemo<QrPayload>(() => {
    if (payload.kind !== "link") return payload;
    const link = props.links.find((l) => l.id === linkId);
    if (!link) return { kind: "link", url: "" };
    return { kind: "link", url: qrTargetUrl(props.baseUrl, link.code) };
  }, [payload, linkId, props.links, props.baseUrl]);

  const state = useQrState(effectivePayload, design, title);

  const patch = useCallback((next: Partial<QrDesign>) => {
    setDesign((current) => normaliseDesign({ ...current, ...next }));
  }, []);

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const base = brandPreset(preset, props.brandColor);
    /*
     * A preset replaces the look and keeps what is already in the middle. A
     * church that has put its logo in and is now trying presets does not want
     * the logo removed by each one — and the version floor is reapplied so the
     * logo still fits whatever grid the preset asked for.
     */
    const keptCentre = design.centre.type !== "none" ? design.centre : base.centre;
    const merged = normaliseDesign({ ...base, centre: keptCentre });
    setDesign(
      normaliseDesign({
        ...merged,
        minVersion: Math.max(merged.minVersion, structuralMinVersion(merged)),
      }),
    );
  }

  function save() {
    if (!title.trim()) {
      toast.error(t("links.giveTheCodeAName"));
      setTab("points");
      return;
    }
    if (state.ok && !state.analysis.scannable) {
      toast.error(t("links.thisDesignWillNotScan"));
      setTab("checks");
      return;
    }
    startSave(async () => {
      const res = await saveCode({
        id: props.codeId,
        title: title.trim(),
        payload,
        design,
        shortLinkId: payload.kind === "link" ? linkId : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("links.saved"));
      if (!props.codeId && res.id) router.replace(`/links/qr/${res.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!props.codeId) return;
    if (
      !confirm(
        `Delete "${title}"? Any printed copies of it keep working — this only removes the design.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const res = await deleteCode(props.codeId!);
      if (res.ok) {
        toast.success(t("links.deleted"));
        router.push("/links");
      } else toast.error(res.error);
    });
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "points", label: "Points at" },
    { id: "look", label: "Look" },
    {
      id: "checks",
      label: "Checks",
      badge: state.ok
        ? state.analysis.findings.filter((f) => f.level !== "note").length
        : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/links">
            <ArrowLeft className="size-4" />
            Links &amp; QR codes
          </Link>
        </Button>
        {props.canManage && (
          <div className="flex items-center gap-2">
            {props.codeId && (
              <Button
                onClick={remove}
                variant="outline"
                disabled={deleting}
                className="min-h-11"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            )}
            <Button onClick={save} disabled={saving} className="min-h-11">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {props.codeId ? "Save" : "Save this code"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("links.whatToCallIt")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder={t("links.carolServiceRegistration")}
          className="min-h-11 text-base font-semibold"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ------------------------------------------- the controls */}
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={cn(
                  "min-h-11 shrink-0 rounded-xl border px-3.5 text-sm font-medium transition",
                  tab === item.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                {item.label}
                {item.badge ? (
                  <span className="bg-amber-500/20 text-amber-700 dark:text-amber-300 ml-1.5 rounded-full px-1.5 text-xs font-semibold">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "points" && (
            <QrPayloadForm
              payload={payload}
              onChange={setPayload}
              links={props.links}
              baseUrl={props.baseUrl}
              canUseShortLinks={props.canUseShortLinks}
              selectedLinkId={linkId}
              onSelectLink={setLinkId}
            />
          )}

          {tab === "look" && (
            <>
              <PresetGallery
                design={design}
                brandColor={props.brandColor}
                onPick={applyPreset}
                onReset={() => setDesign(DEFAULT_DESIGN)}
              />
              <QrControls
                design={design}
                patch={patch}
                churchLogo={props.churchLogo}
                churchInitials={initials}
              />
            </>
          )}

          {tab === "checks" && (
            <div className="bg-card rounded-2xl border p-4 sm:p-5">
              <h3 className="font-semibold">{t("links.everythingTheChecksLookAt")}</h3>
              <ul className="text-muted-foreground mt-3 space-y-2.5 text-xs leading-relaxed">
                <li>
                  <strong className="text-foreground">{t("links.contrast")}</strong> The darkest
                  colour the dots are painted in, against the lightest the background
                  reaches, as a ratio. Under about 3:1 a camera cannot tell them apart in
                  anything but bright light.
                </li>
                <li>
                  <strong className="text-foreground">{t("links.whatTheMiddleCosts")}</strong> Not
                  as a percentage of the picture, which is what every other generator
                  quotes and is eightfold wrong. Error correction repairs whole{" "}
                  <em>{t("links.codewords")}</em> of eight dots each, so the question is how many
                  distinct codewords your logo touches — and that is counted exactly, by
                  walking the same path the message was written along.
                </li>
                <li>
                  <strong className="text-foreground">{t("links.whatIsLeftOver")}</strong> The
                  correction budget is there to survive a crease, a glare, a thumb and a
                  cheap printer. About half of it is as much as a decoration should take;
                  spend it all and the code works on screen and fails on paper.
                </li>
                <li>
                  <strong className="text-foreground">{t("links.theStructure")}</strong> The three
                  corner squares, the dotted lines between them and the format strip
                  carry no redundancy at all. Anything covering those is fatal, and is
                  refused rather than warned about.
                </li>
                <li>
                  <strong className="text-foreground">{t("links.readingItBack")}</strong> The
                  button beside the preview rasterises the finished picture and samples
                  every dot the way a camera does. It is the only honest answer when the
                  dots are filled with a photograph.
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* ------------------------------------------- the preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <QrPreview
            state={state}
            design={design}
            title={title || "QR code"}
            onDownloaded={() => {
              if (props.codeId) void noteCodeDownload(props.codeId);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Presets
 * ========================================================== */

/**
 * Twelve complete looks, each drawn as itself.
 *
 * Drawn rather than named, and drawn from a real encoded symbol rather than
 * from a picture of one, so what is in the gallery is exactly what picking it
 * produces. The payload is a fixed short string — the swatch is about the look,
 * and a preview that changed shape as somebody typed would be unreadable.
 *
 * Every preset in this gallery passes the scannability checks; `design.test.ts`
 * asserts that for all of them, so one cannot be shipped broken.
 */
function PresetGallery({
  design,
  brandColor,
  onPick,
  onReset,
}: {
  design: QrDesign;
  brandColor: string | null;
  onPick: (id: string) => void;
  onReset: () => void;
}) {
  const swatches = useMemo(
    () =>
      PRESETS.map((preset) => {
        const d = brandPreset(preset, brandColor);
        const encoded = encodeQr("https://flockinsight.com/l/abc", {
          ecLevel: d.ecLevel,
          minVersion: Math.max(d.minVersion, structuralMinVersion(d)),
        });
        return {
          id: preset.id,
          name: preset.name,
          blurb: preset.blurb,
          svg: encoded.ok
            ? renderSvg(encoded.symbol, { ...d, frame: { ...d.frame, style: "none" } })
            : null,
        };
      }),
    [brandColor],
  );

  const currentJson = JSON.stringify(design);

  return (
    <section className="bg-card rounded-2xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4" />
            Start from a look
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            Each one is in your church&rsquo;s colour where the colour is the point.
            Picking one keeps whatever you have put in the middle.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} className="min-h-11">
          Plain
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {swatches.map((s) => {
          const active =
            currentJson ===
            JSON.stringify(
              brandPreset(PRESETS.find((p) => p.id === s.id)!, brandColor),
            );
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              title={s.blurb}
              className={cn(
                "relative rounded-xl border p-2 text-left transition",
                active ? "border-primary ring-primary/30 ring-2" : "hover:bg-muted",
              )}
            >
              {active && (
                <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full">
                  <Check className="size-3" />
                </span>
              )}
              {s.svg ? (
                <div
                  className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-lg"
                  // Generated by our own renderer from a fixed string; see the
                  // note in qr-preview.tsx.
                  dangerouslySetInnerHTML={{ __html: s.svg }}
                />
              ) : (
                <div className="bg-muted aspect-square rounded-lg" />
              )}
              <p className="mt-1.5 truncate text-xs font-medium">{s.name}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A blank design, for a new code. */
export function blankDesignerProps(
  over: Partial<DesignerProps> & Pick<DesignerProps, "baseUrl" | "churchName">,
): DesignerProps {
  return {
    codeId: null,
    initialTitle: "",
    initialPayload: blankPayload("link"),
    initialDesign: DEFAULT_DESIGN,
    initialLinkId: null,
    links: [],
    churchLogo: null,
    brandColor: null,
    canUseShortLinks: false,
    canManage: false,
    ...over,
  };
}
