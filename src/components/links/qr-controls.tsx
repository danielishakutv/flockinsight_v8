"use client";

import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUpload } from "@/components/settings/image-upload";
import { cn } from "@/lib/utils";
import { EC_LABEL, EC_LEVELS } from "@/lib/qr/tables";
import {
  CENTRE_ICONS,
  CENTRE_ICON_LABEL,
  CENTRE_SHAPES,
  type CentreIcon,
  type CentreShape,
  EYE_BALLS,
  EYE_BALL_LABEL,
  EYE_FRAMES,
  EYE_FRAME_LABEL,
  FRAME_STYLES,
  FRAME_STYLE_LABEL,
  MODULE_SHAPES,
  MODULE_SHAPE_LABEL,
  minVersionForCentre,
  type QrDesign,
} from "@/lib/qr/design";
import { modulePath } from "@/lib/qr/shapes";
import { useT } from "@/components/i18n-provider";

/**
 * Every knob, in five groups.
 *
 * Grouped by the question being answered rather than by the shape of the data
 * — "the shapes", "the colours", "the middle", "the frame", "how it is built"
 * — because somebody who wants the logo bigger should not have to know that
 * the logo and the error-correction level are related. Where they are related,
 * the control says so in a line underneath.
 *
 * Every control is a plain input with a label. No custom pickers: a native
 * `<input type="color">` opens the operating system's own picker, which is
 * better than anything that could be built here and already works with a
 * screen reader and a thumb.
 */

export type Patch = (patch: Partial<QrDesign>) => void;

export function QrControls({
  design,
  patch,
  churchLogo,
  churchInitials,
}: {
  design: QrDesign;
  patch: Patch;
  churchLogo: string | null;
  churchInitials: string;
}) {
  const t = useT();
  /*
   * Destructured into consts, which is load-bearing rather than tidy.
   *
   * `fill`, `background` and `centre` are discriminated unions, and the
   * handlers below are closures created inside a narrowed branch. TypeScript
   * keeps a narrowing inside a closure only for a `const` binding — for a
   * parameter (or a property of one) it resets, because the value could have
   * changed by the time the closure runs. Reading `fill` inside an
   * onChange therefore loses the narrowing, and the first version of this file
   * papered over that with eighteen `as never` casts, each one of which would
   * have let a gradient's fields be written onto a solid colour.
   */
  const { fill, background, centre } = design;

  return (
    <div className="space-y-5">
      <Group title={t("links.theShapes")} hint={t("links.whatEachDotOfThe")}>
        <ShapePicker design={design} patch={patch} />

        <Field label={t("links.howMuchOfItsSquare")}>
          <Slider
            value={design.moduleScale}
            min={0.55}
            max={1}
            step={0.05}
            onChange={(moduleScale) => patch({ moduleScale })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>

        {design.module === "letters" && (
          <Field
            label={t("links.theLettersToUse")}
            hint={t("links.repeatedThroughTheCodeA")}
          >
            <div className="flex gap-2">
              <Input
                value={design.letters}
                onChange={(e) => patch({ letters: e.target.value.slice(0, 24) })}
                placeholder="GRACE"
                maxLength={24}
                className="min-h-11"
              />
              {churchInitials && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => patch({ letters: churchInitials })}
                >
                  {churchInitials}
                </Button>
              )}
            </div>
          </Field>
        )}

        {design.module === "mosaic" && (
          <Field
            label={t("links.theArrangement")}
            hint={t("links.mosaicHint")}
          >
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => patch({ seed: 1 + Math.floor(Math.random() * 999_999) })}
            >
              <Shuffle className="size-4" />
              Shuffle
            </Button>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("links.theThreeCornerSquares")}>
            <Select
              value={design.eyeFrame}
              onChange={(v) => patch({ eyeFrame: v as QrDesign["eyeFrame"] })}
              options={EYE_FRAMES.map((f) => ({ value: f, label: EYE_FRAME_LABEL[f] }))}
            />
          </Field>
          <Field label={t("links.theirCentres")}>
            <Select
              value={design.eyeBall}
              onChange={(v) => patch({ eyeBall: v as QrDesign["eyeBall"] })}
              options={EYE_BALLS.map((b) => ({ value: b, label: EYE_BALL_LABEL[b] }))}
            />
          </Field>
        </div>
      </Group>

      <Group title={t("links.theColours")} hint={t("links.aCameraNeedsToTell")}>
        <Field label={t("links.theDots")}>
          <Select
            value={fill.type}
            onChange={(type) => patch({ fill: fillOfType(type, design) })}
            options={[
              { value: "solid", label: "One colour" },
              { value: "linear", label: "Gradient" },
              { value: "radial", label: "Gradient from the middle" },
              { value: "rings", label: "Bands of colour" },
              { value: "image", label: "A photograph showing through" },
            ]}
          />
        </Field>

        {fill.type === "solid" && (
          <Colour
            label={t("links.colour")}
            value={fill.color}
            onChange={(color) => patch({ fill: { type: "solid", color } })}
          />
        )}

        {fill.type === "linear" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Colour
                label={t("links.from")}
                value={fill.from}
                onChange={(from) =>
                  patch({ fill: { ...fill, from } })
                }
              />
              <Colour
                label={t("links.to")}
                value={fill.to}
                onChange={(to) =>
                  patch({ fill: { ...fill, to } })
                }
              />
            </div>
            <Field label={t("links.direction")}>
              <Slider
                value={fill.angle}
                min={0}
                max={360}
                step={15}
                onChange={(angle) =>
                  patch({ fill: { ...fill, angle } })
                }
                format={(v) => `${v}°`}
              />
            </Field>
          </>
        )}

        {fill.type === "radial" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Colour
              label={t("links.middle")}
              value={fill.from}
              onChange={(from) =>
                patch({ fill: { ...fill, from } })
              }
            />
            <Colour
              label={t("links.edge")}
              value={fill.to}
              onChange={(to) =>
                patch({ fill: { ...fill, to } })
              }
            />
          </div>
        )}

        {fill.type === "rings" && (
          <Field
            label={t("links.theBandsFromTheMiddle")}
            hint={t("links.eachOneIsAHard")}
          >
            <div className="flex flex-wrap gap-2">
              {fill.colors.map((colour, i) => (
                <input
                  key={i}
                  type="color"
                  aria-label={`Band ${i + 1}`}
                  value={colour}
                  onChange={(e) => {
                    const colors = [...(fill as { colors: string[] }).colors];
                    colors[i] = e.target.value;
                    patch({ fill: { type: "rings", colors } });
                  }}
                  className="size-11 cursor-pointer rounded-lg border bg-transparent p-0.5"
                />
              ))}
              {fill.colors.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    patch({
                      fill: {
                        type: "rings",
                        colors: [...(fill as { colors: string[] }).colors, "#11182a"],
                      },
                    })
                  }
                >
                  Add a band
                </Button>
              )}
              {fill.colors.length > 2 && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    patch({
                      fill: {
                        type: "rings",
                        colors: (fill as { colors: string[] }).colors.slice(0, -1),
                      },
                    })
                  }
                >
                  One fewer
                </Button>
              )}
            </div>
          </Field>
        )}

        {fill.type === "image" && (
          <Field
            label={t("links.thePhotograph")}
            hint={t("links.theDotsBecomeWindowsOnto")}
          >
            <ImageUpload
              value={fill.url || null}
              onChange={(url) => patch({ fill: { type: "image", url: url ?? "" } })}
              kind="cover"
              maxDim={1400}
              label={t("links.chooseAPhotograph")}
              aspect="square"
            />
          </Field>
        )}

        <Field label={t("links.behindIt")}>
          <Select
            value={background.type}
            onChange={(type) => patch({ background: backgroundOfType(type, design) })}
            options={[
              { value: "solid", label: "One colour" },
              { value: "linear", label: "Gradient" },
              { value: "transparent", label: "Nothing (see-through)" },
              { value: "image", label: "A photograph" },
            ]}
          />
        </Field>

        {background.type === "solid" && (
          <Colour
            label={t("links.background")}
            value={background.color}
            onChange={(color) => patch({ background: { type: "solid", color } })}
          />
        )}

        {background.type === "linear" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Colour
              label={t("links.from")}
              value={background.from}
              onChange={(from) =>
                patch({ background: { ...background, from } })
              }
            />
            <Colour
              label={t("links.to")}
              value={background.to}
              onChange={(to) =>
                patch({ background: { ...background, to } })
              }
            />
          </div>
        )}

        {background.type === "image" && (
          <>
            <Field label={t("links.thePhotograph")}>
              <ImageUpload
                value={background.url || null}
                onChange={(url) =>
                  patch({
                    background: { ...background, url: url ?? "" },
                  })
                }
                kind="cover"
                maxDim={1400}
                label={t("links.chooseAPhotograph")}
                aspect="square"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Colour
                label={t("links.veilColour")}
                value={background.scrimColor}
                onChange={(scrimColor) =>
                  patch({
                    background: { ...background, scrimColor },
                  })
                }
              />
              <Field
                label={t("links.howMuchVeil")}
                hint={t("links.veilHint")}
              >
                <Slider
                  value={background.scrim}
                  min={0.35}
                  max={1}
                  step={0.05}
                  onChange={(scrim) =>
                    patch({
                      background: { ...background, scrim },
                    })
                  }
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Field>
            </div>
          </>
        )}

        <Field
          label={t("links.theCornerSquaresSeparately")}
          hint={t("links.leaveTheseMatchingTheDots")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <OptionalColour
              label={t("links.squares")}
              value={design.eyeFrameColor}
              fallback="#11182a"
              onChange={(eyeFrameColor) => patch({ eyeFrameColor })}
            />
            <OptionalColour
              label={t("links.centres")}
              value={design.eyeBallColor}
              fallback="#11182a"
              onChange={(eyeBallColor) => patch({ eyeBallColor })}
            />
          </div>
        </Field>
      </Group>

      <Group
        title={t("links.theMiddle")}
        hint={t("links.anythingHereCoversPartOf")}
      >
        <Field label={t("links.whatGoesInTheMiddle")}>
          <Select
            value={centre.type}
            onChange={(type) => patch({ centre: centreOfType(type, design, churchLogo, churchInitials) })}
            options={[
              { value: "none", label: "Nothing" },
              { value: "image", label: "Your logo" },
              { value: "monogram", label: "Your initials" },
              { value: "icon", label: "A symbol" },
            ]}
          />
        </Field>

        {centre.type !== "none" && (
          <>
            {centre.type === "image" && (
              <Field label={t("links.theLogo")}>
                <ImageUpload
                  value={centre.url || null}
                  onChange={(url) =>
                    patch({
                      centre: { ...centre, url: url ?? "" },
                    })
                  }
                  kind="logo"
                  maxDim={600}
                  label={t("links.chooseALogo")}
                  aspect="square"
                />
              </Field>
            )}

            {centre.type === "monogram" && (
              <Field label={t("links.theLetters")} hint={t("links.twoOrThreeWorkBest")}>
                <Input
                  value={centre.text}
                  onChange={(e) =>
                    patch({
                      centre: { ...centre, text: e.target.value.slice(0, 4) },
                    })
                  }
                  placeholder={churchInitials || "GH"}
                  maxLength={4}
                  className="min-h-11"
                />
              </Field>
            )}

            {centre.type === "icon" && (
              <Field label={t("links.theSymbol")}>
                <Select
                  value={centre.icon}
                  onChange={(icon) =>
                    patch({ centre: { ...centre, icon: icon as CentreIcon } })
                  }
                  options={CENTRE_ICONS.map((i) => ({
                    value: i,
                    label: CENTRE_ICON_LABEL[i],
                  }))}
                />
              </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("links.size")}>
                <Slider
                  value={centre.size}
                  min={0.1}
                  max={0.3}
                  step={0.01}
                  onChange={(size) =>
                    patch({
                      centre: { ...centre, size },
                      // A bigger middle needs a denser grid to sit in, or it
                      // reaches the structure that nothing can repair. Raised
                      // for you rather than left as a trap.
                      minVersion: Math.max(design.minVersion, minVersionForCentre(size)),
                    })
                  }
                  format={(v) => `${Math.round(v * 100)}% across`}
                />
              </Field>
              <Field label={t("links.itsShape")}>
                <Select
                  value={centre.shape}
                  onChange={(shape) =>
                    patch({ centre: { ...centre, shape: shape as CentreShape } })
                  }
                  options={CENTRE_SHAPES.map((s) => ({
                    value: s,
                    label: s === "square" ? "Square" : s === "circle" ? "Circle" : "Rounded",
                  }))}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {centre.type !== "image" && (
                <Colour
                  label={t("links.letterOrSymbolColour")}
                  value={centre.color}
                  onChange={(color) => patch({ centre: { ...centre, color } })}
                />
              )}
              <Colour
                label={t("links.plateBehindIt")}
                value={centre.backdropColor}
                onChange={(backdropColor) =>
                  patch({ centre: { ...centre, backdropColor } })
                }
              />
            </div>
          </>
        )}
      </Group>

      <Group
        title={t("links.theFrame")}
        hint={t("links.frameHint")}
      >
        <Field label={t("links.style")}>
          <Select
            value={design.frame.style}
            onChange={(style) =>
              patch({
                frame: {
                  ...design.frame,
                  style: style as QrDesign["frame"]["style"],
                  // Suggest words the first time a frame is chosen, rather than
                  // showing an empty bar and leaving somebody to wonder.
                  text: design.frame.text || (style === "none" ? "" : "SCAN ME"),
                },
              })
            }
            options={FRAME_STYLES.map((f) => ({ value: f, label: FRAME_STYLE_LABEL[f] }))}
          />
        </Field>

        {design.frame.style !== "none" && (
          <>
            <Field label={t("links.theWords")}>
              <Input
                value={design.frame.text}
                onChange={(e) =>
                  patch({ frame: { ...design.frame, text: e.target.value.slice(0, 60) } })
                }
                placeholder={t("links.scanToGive")}
                maxLength={60}
                className="min-h-11"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Colour
                label={t("links.frameColour")}
                value={design.frame.color}
                onChange={(color) => patch({ frame: { ...design.frame, color } })}
              />
              <Colour
                label={t("links.textColour")}
                value={design.frame.textColor}
                onChange={(textColor) => patch({ frame: { ...design.frame, textColor } })}
              />
            </div>
            <Field label={t("links.where")}>
              <Select
                value={design.frame.position}
                onChange={(position) =>
                  patch({ frame: { ...design.frame, position: position as "top" | "bottom" } })
                }
                options={[
                  { value: "bottom", label: "Underneath" },
                  { value: "top", label: "Above" },
                ]}
              />
            </Field>
          </>
        )}
      </Group>

      <Group title={t("links.howItIsBuilt")} hint={t("links.thePartsAScannerCares")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("links.border")}
            hint={t("links.theClearSpaceAroundThe")}
          >
            <Slider
              value={design.margin}
              min={2}
              max={10}
              step={1}
              onChange={(margin) => patch({ margin })}
              format={(v) => `${v} squares`}
            />
          </Field>
          <Field label={t("links.roundedCorners")}>
            <Slider
              value={design.cornerRadius}
              min={0}
              max={8}
              step={0.5}
              onChange={(cornerRadius) => patch({ cornerRadius })}
              format={(v) => (v === 0 ? "None" : String(v))}
            />
          </Field>
        </div>

        <Field
          label={t("links.errorCorrection")}
          hint={t("links.correctionHint")}
        >
          <Select
            value={design.ecLevel}
            onChange={(ecLevel) => patch({ ecLevel: ecLevel as QrDesign["ecLevel"] })}
            options={EC_LEVELS.map((l) => ({
              value: l,
              label: `${EC_LABEL[l]} (${l})`,
            }))}
          />
        </Field>

        <Field
          label={t("links.smallestGrid")}
          hint={t("links.gridHint")}
        >
          <Slider
            value={design.minVersion}
            min={1}
            max={12}
            step={1}
            onChange={(minVersion) => patch({ minVersion })}
            format={(v) => (v === 1 ? "As small as it fits" : `${v * 4 + 17} squares or more`)}
          />
        </Field>
      </Group>
    </div>
  );
}

/* ============================================================
 * Switching between variants
 *
 * Each of these keeps whatever the new variant shares with the old one, so
 * changing from a gradient to one colour and back does not lose the gradient's
 * colours. Nothing a person chose is thrown away by a change of type.
 * ========================================================== */

function fillOfType(type: string, design: QrDesign): QrDesign["fill"] {
  const current = design.fill;
  const colour =
    current.type === "solid"
      ? current.color
      : current.type === "linear" || current.type === "radial"
        ? current.from
        : "#11182a";
  switch (type) {
    case "linear":
      return { type: "linear", from: colour, to: "#075985", angle: 45 };
    case "radial":
      return { type: "radial", from: colour, to: "#11182a" };
    case "rings":
      return { type: "rings", colors: [colour, "#0ea5e9", "#11182a"] };
    case "image":
      return { type: "image", url: current.type === "image" ? current.url : "" };
    default:
      return { type: "solid", color: colour };
  }
}

function backgroundOfType(type: string, design: QrDesign): QrDesign["background"] {
  const current = design.background;
  const colour =
    current.type === "solid"
      ? current.color
      : current.type === "linear"
        ? current.from
        : "#ffffff";
  switch (type) {
    case "transparent":
      return { type: "transparent" };
    case "linear":
      return { type: "linear", from: colour, to: "#eef2ff", angle: 45 };
    case "image":
      return {
        type: "image",
        url: current.type === "image" ? current.url : "",
        scrim: current.type === "image" ? current.scrim : 0.75,
        scrimColor: "#ffffff",
      };
    default:
      return { type: "solid", color: colour };
  }
}

function centreOfType(
  type: string,
  design: QrDesign,
  churchLogo: string | null,
  churchInitials: string,
): QrDesign["centre"] {
  const size = design.centre.type !== "none" ? design.centre.size : 0.2;
  const backdropColor =
    design.centre.type !== "none" ? design.centre.backdropColor : "#11182a";
  switch (type) {
    case "image":
      // The church's own logo, already uploaded, is the answer nine times out
      // of ten — so it is filled in rather than offered.
      return {
        type: "image",
        url: design.centre.type === "image" ? design.centre.url : (churchLogo ?? ""),
        size,
        shape: design.centre.type !== "none" ? design.centre.shape : "circle",
        backdrop: true,
        backdropColor: "#ffffff",
      };
    case "monogram":
      return {
        type: "monogram",
        text: design.centre.type === "monogram" ? design.centre.text : churchInitials,
        size,
        shape: design.centre.type !== "none" ? design.centre.shape : "circle",
        color: "#ffffff",
        backdropColor,
      };
    case "icon":
      return {
        type: "icon",
        icon: design.centre.type === "icon" ? design.centre.icon : "cross",
        size,
        shape: design.centre.type !== "none" ? design.centre.shape : "rounded",
        color: "#ffffff",
        backdropColor,
      };
    default:
      return { type: "none" };
  }
}

/* ============================================================
 * The little pieces
 * ========================================================== */

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-2xl border p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      {hint && (
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{hint}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Colour({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-11 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 font-mono text-xs"
          aria-label={`${label} as a hex code`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/** A colour that may be "same as the dots". */
function OptionalColour({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value)}
        className="size-11 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5"
      />
      <button
        type="button"
        onClick={() => onChange(value === null ? fallback : null)}
        className={cn(
          "min-h-11 rounded-lg border px-3 text-xs font-medium transition",
          value === null
            ? "text-muted-foreground hover:bg-muted"
            : "border-primary bg-primary/10 text-primary",
        )}
      >
        {label}: {value === null ? "same as the dots" : "its own"}
      </button>
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary h-11 min-w-0 flex-1 cursor-pointer"
      />
      <span className="text-muted-foreground w-28 shrink-0 text-right text-xs tabular-nums">
        {format(value)}
      </span>
    </div>
  );
}

/**
 * The module shapes, each drawn as itself.
 *
 * A list of names ("Squircle", "Fluid", "Mosaic") is unusable — nobody knows
 * what those look like, and finding out means fourteen round trips through a
 * dropdown and back to the preview. Each swatch is a 3×3 of the real shape,
 * built by the same `modulePath` the code itself uses, so what is shown is
 * exactly what will be drawn.
 */
function ShapePicker({ design, patch }: { design: QrDesign; patch: Patch }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {MODULE_SHAPES.map((shape) => {
        const active = design.module === shape;
        return (
          <button
            key={shape}
            type="button"
            onClick={() => patch({ module: shape })}
            aria-pressed={active}
            title={MODULE_SHAPE_LABEL[shape]}
            className={cn(
              "flex min-h-11 flex-col items-center gap-1 rounded-xl border p-1.5 transition",
              active ? "border-primary bg-primary/10" : "hover:bg-muted",
            )}
          >
            <svg viewBox="0 0 3 3" className="w-full" aria-hidden>
              {shape === "letters" ? (
                <text
                  x={1.5}
                  y={1.62}
                  textAnchor="middle"
                  fontSize={1.9}
                  fontWeight={800}
                  fill="currentColor"
                >
                  A
                </text>
              ) : (
                <path
                  d={swatchPath(shape)}
                  fill="currentColor"
                  className={active ? "text-primary" : "text-foreground/75"}
                />
              )}
            </svg>
            <span className="text-[10px] leading-tight font-medium">
              {MODULE_SHAPE_LABEL[shape]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A little pattern of the shape, with gaps, so a neighbour-aware shape like
 * `fluid` shows what it actually does rather than appearing as plain squares.
 */
function swatchPath(shape: QrDesign["module"]): string {
  const cells: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 2],
    [0, 2],
  ];
  const filled = new Set(cells.map(([x, y]) => `${x},${y}`));
  let d = "";
  for (const [x, y] of cells) {
    d += modulePath(
      shape,
      x,
      y,
      1,
      {
        up: filled.has(`${x},${y - 1}`),
        down: filled.has(`${x},${y + 1}`),
        left: filled.has(`${x - 1},${y}`),
        right: filled.has(`${x + 1},${y}`),
      },
      7,
    );
  }
  return d;
}
