"use client";

import { useMemo } from "react";
import { Check, Image as ImageIcon, Minus, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUpload } from "@/components/settings/image-upload";
import { cn } from "@/lib/utils";
import { CHURCH_THEMES } from "@/lib/church-themes";
import { encodeQr } from "@/lib/qr/encode";
import { renderSvg } from "@/lib/qr/render";
import {
  SIMPLE_STYLES,
  STYLE_LABEL,
  designFor,
  type SimpleChoice,
  type SimpleStyle,
} from "@/lib/qr/simple";
import { useT } from "@/components/i18n-provider";

/**
 * Four choices, and that is the whole panel.
 *
 * It replaced thirty-odd controls — fourteen module shapes, eight eye frames,
 * five fill types, gradients, bands of colour, a correction level, a grid
 * floor, a quiet zone, a module scale. They existed so that twelve presets
 * could differ from each other, and the cost was that most combinations warned
 * and some could not be saved at all: measured, a logo at the natural size
 * blocked twelve of forty-eight style-and-size combinations and warned on
 * seventeen more.
 *
 * What makes four enough is that `autoFix` now decides everything that affects
 * whether the code works — the correction level, the grid, and the exact shade
 * of the colour — so nothing left here can break it. The knobs were never the
 * feature; they were the price of having no auto-fix.
 */

export function QrControls({
  choice,
  onChange,
  churchLogo,
  churchInitials,
}: {
  choice: SimpleChoice;
  onChange: (choice: SimpleChoice) => void;
  churchLogo: string | null;
  churchInitials: string;
}) {
  const t = useT();
  const set = (patch: Partial<SimpleChoice>): void => onChange({ ...choice, ...patch });

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------- 1. the look */}
      <section className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="font-semibold">{t("links.theLook")}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {SIMPLE_STYLES.map((style) => (
            <StyleTile
              key={style}
              style={style}
              colour={choice.colour}
              active={choice.style === style}
              onPick={() => set({ style })}
            />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- 2. the colour */}
      <section className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="font-semibold">{t("links.theColour")}</h3>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {t("links.pickAnythingIfAColour")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => set({ colour: swatch })}
              aria-label={`Use the colour ${swatch}`}
              aria-pressed={choice.colour === swatch}
              /*
               * An unselected swatch keeps a visible rim. With a transparent
               * border the first swatch — the near-black one that is the right
               * answer for anything going near a photocopier — disappeared
               * completely into the dark card behind it, so the row read as
               * starting with a hole.
               */
              className={cn(
                "grid size-11 place-items-center rounded-xl border-2 transition",
                choice.colour === swatch ? "border-foreground" : "border-border",
              )}
              style={{ backgroundColor: swatch }}
            >
              {choice.colour === swatch && <Check className="size-4 text-white" />}
            </button>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-2.5 text-xs font-medium">
            <input
              type="color"
              value={choice.colour}
              onChange={(e) => set({ colour: e.target.value })}
              aria-label={t("links.chooseAnotherColour")}
              className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            {t("links.otherColour")}
          </label>
        </div>
      </section>

      {/* ------------------------------------------------- 3. the middle */}
      <section className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="font-semibold">{t("links.inTheMiddle")}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiddleTile
            icon={<Minus className="size-4" />}
            label={t("links.nothing")}
            active={choice.middle.kind === "none"}
            onPick={() => set({ middle: { kind: "none" } })}
          />
          <MiddleTile
            icon={<Type className="size-4" />}
            label={t("links.letters")}
            active={choice.middle.kind === "letters"}
            onPick={() =>
              set({
                middle: {
                  kind: "letters",
                  text:
                    choice.middle.kind === "letters" ? choice.middle.text : churchInitials,
                },
              })
            }
          />
          <MiddleTile
            icon={<ImageIcon className="size-4" />}
            label={t("links.yourLogo")}
            active={choice.middle.kind === "logo"}
            onPick={() =>
              set({
                middle: {
                  kind: "logo",
                  url: choice.middle.kind === "logo" ? choice.middle.url : (churchLogo ?? ""),
                },
              })
            }
          />
        </div>

        {choice.middle.kind === "letters" && (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="qr-letters" className="text-xs font-medium">
              {t("links.whichLettersTwoOrThree")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="qr-letters"
                value={choice.middle.text}
                onChange={(e) =>
                  set({ middle: { kind: "letters", text: e.target.value.slice(0, 4) } })
                }
                placeholder={churchInitials || "GH"}
                maxLength={4}
                className="min-h-11 font-semibold uppercase"
              />
              {churchInitials && choice.middle.text !== churchInitials && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => set({ middle: { kind: "letters", text: churchInitials } })}
                >
                  Use {churchInitials}
                </Button>
              )}
            </div>
          </div>
        )}

        {choice.middle.kind === "logo" && (
          <div className="mt-3 space-y-2">
            <ImageUpload
              value={choice.middle.url || null}
              onChange={(url) => set({ middle: { kind: "logo", url: url ?? "" } })}
              kind="logo"
              maxDim={600}
              label={t("links.chooseALogo")}
              aspect="square"
            />
            {churchLogo && choice.middle.url !== churchLogo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => set({ middle: { kind: "logo", url: churchLogo } })}
              >
                {t("links.useMyChurchLogo")}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------- 4. the caption */}
      <section className="bg-card rounded-2xl border p-4 sm:p-5">
        <Label htmlFor="qr-caption" className="font-semibold">
          {t("links.wordsUnderneath")}
        </Label>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {t("links.optionalAndItMakesA")}
        </p>
        <Input
          id="qr-caption"
          value={choice.caption}
          onChange={(e) => set({ caption: e.target.value.slice(0, 40) })}
          placeholder={t("links.scanToGive")}
          maxLength={40}
          className="mt-3 min-h-11"
        />
      </section>
    </div>
  );
}

/* ============================================================
 * The swatches
 * ========================================================== */

/**
 * The seven public-page themes, plus black.
 *
 * Read from `church-themes.ts` rather than listed again, so the colours on
 * offer here are the ones a church has already chosen between for its own
 * page. Black is first because it is the right answer for anything going near
 * a photocopier.
 */
const SWATCHES: string[] = ["#11182a", ...CHURCH_THEMES.map((theme) => theme.primary)];

/* ============================================================
 * The tiles
 * ========================================================== */

/**
 * A style, drawn as itself.
 *
 * Rendered from a real encoded symbol rather than from a picture of one, so
 * the tile is exactly what picking it produces. The payload is a fixed short
 * string, so the tiles do not reshuffle while somebody types the destination.
 */
function StyleTile({
  style,
  colour,
  active,
  onPick,
}: {
  style: SimpleStyle;
  colour: string;
  active: boolean;
  onPick: () => void;
}) {
  const svg = useMemo(() => {
    const design = designFor({ style, colour, middle: { kind: "none" }, caption: "" });
    const encoded = encodeQr("https://flockinsight.com/l/abc", {
      ecLevel: design.ecLevel,
      minVersion: design.minVersion,
    });
    return encoded.ok ? renderSvg(encoded.symbol, design) : null;
  }, [style, colour]);

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        "overflow-hidden rounded-xl border p-1.5 transition",
        active ? "border-primary ring-primary/30 ring-2" : "hover:bg-muted",
      )}
    >
      {svg ? (
        <div
          className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-lg"
          // Our own renderer, from a fixed string. See the note in
          // qr-preview.tsx on why this cannot carry anything a person typed.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="bg-muted aspect-square rounded-lg" />
      )}
      <span className="mt-1 block truncate text-[11px] font-medium">
        {STYLE_LABEL[style]}
      </span>
    </button>
  );
}

function MiddleTile({
  icon,
  label,
  active,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      /*
       * Icon ABOVE the words on a phone, beside them from `sm` up.
       *
       * Three columns across a 320px screen leaves 96px a cell, and "Your
       * logo" plus an icon on one line does not fit that comfortably — the
       * mobile audit flags a three-column grid holding words for exactly this
       * reason. Stacking gives the label the whole 96px.
       */
      className={cn(
        "flex min-h-11 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border px-1.5 py-2 text-[11px] font-medium transition sm:flex-row sm:gap-1.5 sm:px-2 sm:text-xs",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
