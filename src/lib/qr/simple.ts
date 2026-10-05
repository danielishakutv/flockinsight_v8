/**
 * The simple way to make a QR code: four choices, and it always works.
 *
 * WHY THIS FILE EXISTS. The first version of this module exposed every knob the
 * renderer has — fourteen module shapes, eight eye frames, five fills, a
 * correction level, a grid floor — and then CHECKED the result and told the
 * church what was wrong with it. Measured across realistic choices, that was a
 * bad deal: adding a logo at the natural size blocked 12 of 48 style-and-size
 * combinations outright and warned on 17 more, and letters in the middle
 * blocked at 30% and warned at 20%. The one thing a church actually wants — its
 * mark in the middle — was the thing that failed.
 *
 * And the findings were already naming the remedy: "raise the correction
 * level, or raise Smallest grid". The engine knew the fix and asked a person to
 * apply it. That is the bug, not the checks.
 *
 * SO THE CHECKS NOW DRIVE A FIX INSTEAD OF A WARNING. `autoFix` takes what
 * somebody asked for and returns something that scans, by doing exactly what
 * the findings said: strongest correction level that fits, a denser grid until
 * the middle is inside the damage budget, and the same brand colour moved
 * darker until a camera can read it. It reports what it changed, because a
 * silent correction is its own kind of lie — but it does not ask permission,
 * and it cannot fail.
 *
 * That inverts the relationship: settings are no longer dangerous, so there is
 * no longer a reason to put a scannability panel in front of somebody. Four
 * choices, one line saying what was adjusted, done.
 */

import {
  DEFAULT_DESIGN,
  adjustForContrast,
  backgroundColors,
  fillColors,
  contrastRatio,
  isHexColor,
  minVersionForCentre,
  normaliseDesign,
  structuralMinVersion,
  type QrDesign,
} from "@/lib/qr/design";
import { encodeQr, hasCentralAlignment, type QrSymbol } from "@/lib/qr/encode";
import { analyse } from "@/lib/qr/verify";
import { EC_LEVELS, type EcLevel } from "@/lib/qr/tables";

/* ============================================================
 * The four choices
 * ========================================================== */

export const SIMPLE_STYLES = [
  "classic",
  "rounded",
  "dots",
  "soft",
  "fluid",
  "bold",
] as const;

export type SimpleStyle = (typeof SIMPLE_STYLES)[number];

export const STYLE_LABEL: Record<SimpleStyle, string> = {
  classic: "Classic",
  rounded: "Rounded",
  dots: "Dots",
  soft: "Soft",
  fluid: "Fluid",
  bold: "Bold",
};

export type SimpleMiddle =
  | { kind: "none" }
  /** Your church's initials, or a short word. */
  | { kind: "letters"; text: string }
  | { kind: "logo"; url: string };

export type SimpleChoice = {
  style: SimpleStyle;
  /** One hex colour. The background is always white — see below. */
  colour: string;
  middle: SimpleMiddle;
  /** Words under the code. Empty for none. */
  caption: string;
};

export const DEFAULT_CHOICE: SimpleChoice = {
  style: "rounded",
  colour: "#11182a",
  middle: { kind: "none" },
  caption: "",
};

/**
 * The background is always white, and that is a decision rather than an
 * omission.
 *
 * A dark background makes an inverted code, which some handheld and till
 * scanners refuse outright; a photograph behind the code makes the contrast
 * unknowable without rasterising it. Both were offered, both generated
 * warnings nobody could act on, and neither is what a church asks for. White
 * prints, photocopies, and scans everywhere.
 */
const PAPER = "#ffffff";

/** Mend a stored choice, so a row written by an older build still opens. */
export function normaliseChoice(raw: unknown): SimpleChoice {
  const o = (raw ?? {}) as Record<string, unknown>;
  const style = SIMPLE_STYLES.includes(o.style as SimpleStyle)
    ? (o.style as SimpleStyle)
    : DEFAULT_CHOICE.style;
  const colour = isHexColor(o.colour) ? o.colour.trim().toLowerCase() : DEFAULT_CHOICE.colour;
  const caption = typeof o.caption === "string" ? o.caption.slice(0, 40) : "";

  const m = (o.middle ?? {}) as Record<string, unknown>;
  let middle: SimpleMiddle = { kind: "none" };
  if (m.kind === "letters") {
    middle = { kind: "letters", text: typeof m.text === "string" ? m.text.slice(0, 4) : "" };
  } else if (m.kind === "logo") {
    middle = { kind: "logo", url: typeof m.url === "string" ? m.url.slice(0, 1000) : "" };
  }

  return { style, colour, middle, caption };
}

/* ============================================================
 * A choice becomes a design
 * ========================================================== */

type StyleShape = Pick<QrDesign, "module" | "eyeFrame" | "eyeBall" | "cornerRadius">;

/**
 * Each style's shapes, and the triple is UNIQUE for a reason.
 *
 * A saved code stores the finished design, not the choice that produced it, so
 * reopening one has to read the style back out of the shapes (see
 * `choiceFromDesign`). The first version of this table gave `classic` and
 * `bold` the same three shapes and told them apart by correction level \u2014 which
 * the auto-fix then changes, so a saved "Classic with a logo" reopened as
 * "Bold". Different eyes instead: nothing downstream can overwrite those.
 */
const STYLE_SHAPES: Record<SimpleStyle, StyleShape> = {
  classic: { module: "square", eyeFrame: "square", eyeBall: "square", cornerRadius: 0 },
  rounded: { module: "rounded", eyeFrame: "rounded", eyeBall: "rounded", cornerRadius: 2 },
  dots: { module: "dot", eyeFrame: "circle", eyeBall: "circle", cornerRadius: 3 },
  soft: { module: "squircle", eyeFrame: "cushion", eyeBall: "rounded", cornerRadius: 3 },
  fluid: { module: "fluid", eyeFrame: "rounded", eyeBall: "circle", cornerRadius: 3 },
  bold: { module: "square", eyeFrame: "cushion", eyeBall: "diamond", cornerRadius: 0 },
};

/**
 * The size of the middle, in one place.
 *
 * A fifth of the width. Big enough to read a logo or two letters at poster
 * size, and small enough that `autoFix` can almost always fit it by raising
 * the grid rather than by shrinking it. Not a setting: it was one, and "how
 * big may my logo be" is a question about error-correction codewords that
 * nobody should have to hold an opinion about.
 */
const MIDDLE_SIZE = 0.2;

/** Everything a choice implies, before the auto-fix looks at it. */
export function designFor(choice: SimpleChoice): QrDesign {
  const c = normaliseChoice(choice);
  const shape = STYLE_SHAPES[c.style];

  const centre: QrDesign["centre"] =
    c.middle.kind === "letters" && c.middle.text.trim()
      ? {
          /*
           * Letters on PAPER, not on the brand colour — which is the opposite
           * of what this used to do, and the reason it looked broken.
           *
           * The plate was filled with `c.colour`, the same colour as every
           * module around it, so there was nothing to separate the two: the
           * mark merged into its neighbours and read as a lumpy blob with
           * white letters floating on it. Worse, a scanner saw the same thing
           * a person did — plate-coloured pixels where it expected modules is
           * plausible data, and plausible data is not correctable, whereas a
           * clean light hole is. The logo branch below already knew this. Now
           * both say it the same way.
           */
          type: "monogram",
          text: c.middle.text.trim(),
          size: MIDDLE_SIZE,
          shape: "circle",
          color: c.colour,
          backdropColor: PAPER,
        }
      : c.middle.kind === "logo" && c.middle.url
        ? {
            type: "image",
            url: c.middle.url,
            size: MIDDLE_SIZE,
            shape: "circle",
            backdrop: true,
            backdropColor: PAPER,
          }
        : { type: "none" };

  return normaliseDesign({
    ...DEFAULT_DESIGN,
    ...shape,
    // Always full-size modules. A shrunken sparse shape is the fastest way to
    // an unreadable code and it buys nothing a church asked for.
    moduleScale: 1,
    fill: { type: "solid", color: c.colour },
    background: { type: "solid", color: PAPER },
    centre,
    frame: c.caption.trim()
      ? {
          style: "bar",
          text: c.caption.trim(),
          position: "bottom",
          color: c.colour,
          textColor: PAPER,
        }
      : { ...DEFAULT_DESIGN.frame, style: "none", text: "" },
    // The standard's quiet zone, never less.
    margin: 4,
    /*
     * Medium here, and the auto-fix raises it. The style deliberately does not
     * decide the correction level: what the level needs to be is a function of
     * what is in the middle, not of taste, and letting both decide it is how
     * the two came to contradict each other.
     */
    ecLevel: "M",
  });
}

/**
 * The choice that produced a design, read back out of it.
 *
 * A saved code stores the finished design \u2014 the one the auto-fix produced \u2014
 * because that is what has to render identically next year. So reopening one
 * in the simple panel means recovering the four choices from it. Lossy by
 * nature and harmless in practice: the parts that cannot be recovered (the
 * correction level, the grid size) are exactly the parts nobody chose, and the
 * auto-fix recomputes them from scratch anyway.
 *
 * Anything unrecognisable comes back as the nearest style rather than as an
 * error, so a code made by an older build still opens and still renders.
 */
export function choiceFromDesign(design: QrDesign): SimpleChoice {
  const d = normaliseDesign(design);
  const entries = Object.entries(STYLE_SHAPES) as [SimpleStyle, StyleShape][];

  const style =
    entries.find(
      ([, shape]) =>
        shape.module === d.module &&
        shape.eyeFrame === d.eyeFrame &&
        shape.eyeBall === d.eyeBall,
    )?.[0] ??
    // Nearest by module shape alone, then the default.
    entries.find(([, shape]) => shape.module === d.module)?.[0] ??
    DEFAULT_CHOICE.style;

  const middle: SimpleMiddle =
    d.centre.type === "monogram"
      ? { kind: "letters", text: d.centre.text }
      : d.centre.type === "image"
        ? { kind: "logo", url: d.centre.url }
        : { kind: "none" };

  /*
   * The colour is the fill, where the fill is a colour. For a gradient or a
   * photograph \u2014 only reachable from a design made by an older build \u2014 the
   * first colour is the closest honest answer.
   */
  const colour =
    d.fill.type === "solid"
      ? d.fill.color
      : d.fill.type === "linear" || d.fill.type === "radial"
        ? d.fill.from
        : d.centre.type === "monogram"
          ? d.centre.backdropColor
          : DEFAULT_CHOICE.colour;

  return normaliseChoice({
    style,
    colour,
    middle,
    caption: d.frame.style === "none" ? "" : d.frame.text,
  });
}

/* ============================================================
 * The auto-fix
 * ========================================================== */

export type AutoFixChange = {
  /** Stable, so a UI can treat one specially without matching text. */
  key: "colour" | "correction" | "grid" | "middle-smaller" | "middle-removed";
  /** One short sentence, in the first person plural. What, and why. */
  text: string;
};

export type AutoFixResult = {
  design: QrDesign;
  symbol: QrSymbol;
  changes: AutoFixChange[];
};

export type AutoFixFailure = { error: string };

/**
 * How much of the correction budget the middle may spend.
 *
 * Half, so the other half is left for the world — a crease, a glare, a thumb
 * over the corner, a cheap printer. This is the same figure `verify.ts` warns
 * at; the difference is that here it is a target to engineer towards rather
 * than a line to report crossing.
 */
const MIDDLE_BUDGET = 0.5;

/** Comfortable on an old phone in a dim foyer. */
const CONTRAST_TARGET = 4.5;

/**
 * The densest grid the fix will reach for.
 *
 * Beyond about 25 modules of extra width the squares get small enough that
 * printing becomes the limit instead, so past here it shrinks the middle
 * instead of growing the code. Version 14 is 73 modules across.
 */
const MAX_VERSION = 14;

/**
 * Make it work.
 *
 * Takes the text to encode and the design somebody asked for, and returns a
 * design that scans — along with what had to change. Never refuses except when
 * the text itself cannot fit in a QR code at all, which is the one failure a
 * church can actually act on (shorten it, or use a short link).
 *
 * The order is deliberate: colour first, because it is independent; then the
 * middle, because fitting it is what decides the correction level and the
 * grid, and those two are the expensive ones.
 */
export function autoFix(
  text: string,
  requested: QrDesign,
): AutoFixResult | AutoFixFailure {
  const changes: AutoFixChange[] = [];
  let design = normaliseDesign(requested);

  /* ---------------------------------------------------- colour */
  const inks = fillColors(design.fill);
  const papers = backgroundColors(design.background);
  if (inks.length > 0 && papers.length > 0 && design.fill.type === "solid") {
    const paper = papers[0];
    const worst = Math.min(...inks.map((ink) => contrastRatio(ink, paper)));
    if (worst < CONTRAST_TARGET) {
      const fixed = adjustForContrast(design.fill.color, paper, CONTRAST_TARGET);
      if (fixed !== design.fill.color) {
        changes.push({
          key: "colour",
          text: `We used a darker shade of your colour, so a phone camera can tell the squares from the paper.`,
        });
        design = normaliseDesign({ ...design, fill: { type: "solid", color: fixed } });
      }
    }
  }

  /* ---------------------------------------------------- the middle */
  const wantsMiddle =
    design.centre.type !== "none" &&
    !(design.centre.type === "image" && !design.centre.url);

  if (!wantsMiddle) {
    const attempt = tryEncode(text, design);
    if (!attempt) return { error: tooLong(text) };
    return { design, symbol: attempt.symbol, changes };
  }

  const askedLevel = design.ecLevel;
  const askedSize = design.centre.type === "none" ? MIDDLE_SIZE : design.centre.size;

  /*
   * WHAT ACTUALLY FIXES A MIDDLE, measured rather than assumed.
   *
   * The correction level does almost all of the work and the grid size does
   * very little. A 20%-wide middle covers about the same SHARE of the symbol
   * whatever the version — the area it hides and the number of codewords both
   * scale with the square of the width — so a denser grid barely moves the
   * ratio. What moves it is redundancy: at Medium the budget is about 3.7% of
   * the codewords and the middle costs about 5%, so it warns; at High the
   * budget is about 7.5% and the same middle is comfortable.
   *
   * So: take the strongest level the text will fit in, and stop. That is one
   * encode in the common case, which matters because this runs on every
   * keystroke of the preview.
   *
   * The grid is still used, for one specific thing. Versions 7 to 13 put an
   * alignment ring exactly at the centre of the symbol, so a middle there
   * covers it — survivable, but free to avoid by nudging the version to 14 or
   * holding it at 6. `preferredVersions` does that, and the search falls back
   * to accepting the ring rather than refusing.
   */
  const level = strongestLevelFor(text) ?? askedLevel;

  for (const size of sizeLadder(askedSize)) {
    const sized = withCentreSize(design, size);
    const floor = Math.max(minVersionForCentre(size), structuralMinVersion(sized));

    for (const pass of ["avoid-alignment", "accept-alignment"] as const) {
      for (const version of candidateVersions(text, level, floor, pass)) {
        const candidate = normaliseDesign({ ...sized, ecLevel: level, minVersion: version });
        const attempt = tryEncode(text, candidate);
        if (!attempt) continue;

        if (pass === "avoid-alignment" && hasCentralAlignment(attempt.symbol.version)) {
          continue;
        }

        // Judge what the encoder actually produced, not what we asked for.
        const result = analyse(attempt.symbol, candidate);
        const fits =
          result.metrics.functionDamage.structural === 0 &&
          result.metrics.spoiled <= result.metrics.correctable * MIDDLE_BUDGET;
        if (!fits) continue;

        if (level !== askedLevel) {
          changes.push({
            key: "correction",
            text: "We turned the error correction up, so the middle does not cost the code anything it needs.",
          });
        }
        if (attempt.symbol.version > naturalVersion(text, level)) {
          changes.push({
            key: "grid",
            text: `We used a denser grid (${attempt.symbol.size} squares across) so the middle clears the code's own markings.`,
          });
        }
        if (size < askedSize - 1e-9) {
          changes.push({
            key: "middle-smaller",
            text: "We made the middle a little smaller so the code can still be read.",
          });
        }
        return { design: candidate, symbol: attempt.symbol, changes };
      }
    }
  }

  /*
   * Nothing fitted at any size down to a tenth of the width. Only reachable
   * with a payload long enough to crowd the densest grid, and the honest
   * answer then is a code that scans without the logo plus a sentence naming
   * the way to get the logo back.
   */
  const bare = normaliseDesign({ ...design, centre: { type: "none" } });
  const attempt = tryEncode(text, bare);
  if (!attempt) return { error: tooLong(text) };
  changes.push({
    key: "middle-removed",
    text: "What this points at is long enough that the code has no room for a middle. Point it at a short link instead and your logo will fit.",
  });
  return { design: bare, symbol: attempt.symbol, changes };
}

/* ------------------------------------------------------------------ bits */

function tryEncode(text: string, design: QrDesign): { symbol: QrSymbol } | null {
  const res = encodeQr(text, {
    ecLevel: design.ecLevel,
    minVersion: Math.max(design.minVersion, structuralMinVersion(design)),
  });
  return res.ok ? { symbol: res.symbol } : null;
}

/** The strongest correction level this text still fits in, or null if none do. */
function strongestLevelFor(text: string): EcLevel | null {
  for (const level of [...EC_LEVELS].reverse()) {
    if (encodeQr(text, { ecLevel: level }).ok) return level;
  }
  return null;
}

/** The version this text needs with no floor, for "did we make it denser". */
function naturalVersion(text: string, level: EcLevel): number {
  const res = encodeQr(text, { ecLevel: level });
  return res.ok ? res.symbol.version : 1;
}

/**
 * Versions worth trying, in order, and deliberately few.
 *
 * The natural version first, because a denser code than the message needs
 * makes the squares smaller to print. Then a handful of nudges upward — only
 * useful for stepping over the versions that carry a central alignment ring,
 * which is a short walk: 7 to 13 are the only ones, so from 6 the next clear
 * version is 14.
 */
function candidateVersions(
  text: string,
  level: EcLevel,
  floor: number,
  pass: "avoid-alignment" | "accept-alignment",
): number[] {
  const natural = Math.max(floor, naturalVersion(text, level));
  if (pass === "accept-alignment") return [natural];

  /*
   * ONE STEP, and no more. Avoiding the central alignment ring is worth a
   * nudge and not worth a jump: versions 7 to 13 all carry one, so from
   * version 6 the next clear version is 14 — and growing a symbol from 57
   * modules to 73 makes every square 22% smaller at the same printed size.
   * That trades a real cost (a code too fine to print) for a tolerance cost
   * (a steep angle), which is the wrong way round.
   *
   * So the nudge only happens where it is cheap, which in practice is version
   * 13 stepping to 14. Everywhere else the ring is simply accepted, which is
   * what every other QR generator does and what the measurement said is fine.
   */
  if (natural + 1 <= MAX_VERSION && !hasCentralAlignment(natural + 1)) {
    return [natural, natural + 1];
  }
  return [natural];
}

/**
 * Middle sizes to try: the one asked for, then smaller.
 *
 * Never larger. Growing somebody's logo beyond what they chose would be this
 * function having an opinion about their design rather than about whether it
 * works.
 */
function sizeLadder(asked: number): number[] {
  const out: number[] = [];
  for (let size = asked; size >= 0.1 - 1e-9; size -= 0.02) {
    out.push(Math.round(size * 1000) / 1000);
  }
  return out;
}

function withCentreSize(design: QrDesign, size: number): QrDesign {
  if (design.centre.type === "none") return design;
  return normaliseDesign({ ...design, centre: { ...design.centre, size } });
}

function tooLong(text: string): string {
  return `That is too long for a QR code — ${[...text].length} characters. Shorten it, or point the code at a short link instead.`;
}

/* ============================================================
 * One call, for the UI
 * ========================================================== */

export type SimpleResult =
  | { ok: true; design: QrDesign; symbol: QrSymbol; changes: AutoFixChange[] }
  | { ok: false; error: string };

/** A choice and a payload in; something that scans out. */
export function buildSimple(text: string, choice: SimpleChoice): SimpleResult {
  if (!text) return { ok: false, error: "Add what the code should open." };
  const fixed = autoFix(text, designFor(choice));
  if ("error" in fixed) return { ok: false, error: fixed.error };
  return { ok: true, design: fixed.design, symbol: fixed.symbol, changes: fixed.changes };
}
