import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE,
  SIMPLE_STYLES,
  autoFix,
  buildSimple,
  choiceFromDesign,
  designFor,
  normaliseChoice,
  type SimpleChoice,
  type SimpleMiddle,
} from "@/lib/qr/simple";
import {
  adjustForContrast,
  contrastRatio,
  hexToHsl,
  hslToHex,
  normaliseDesign,
  structuralMinVersion,
} from "@/lib/qr/design";
import { encodeQr } from "@/lib/qr/encode";
import { analyse, confidenceOf } from "@/lib/qr/verify";
import { renderSvg } from "@/lib/qr/render";

/**
 * The promise this file exists to keep: whatever is chosen, the code scans.
 *
 * The previous design checked the result and reported what was wrong with it.
 * Measured across realistic choices that blocked 12 of 48 style-and-logo
 * combinations and warned on 17 more — so the sweep below is not a smoke test,
 * it is the regression that the complaint turned into. Every combination a
 * person can reach through the simple panel is built and then put back through
 * the same analysis, and none of them may come out blocked.
 */

/** The seven church theme colours, which is what a church actually picks. */
const BRANDS = [
  "#5b3df5",
  "#0284c7",
  "#059669",
  "#ea580c",
  "#7c3aed",
  "#db2777",
  "#334155",
];

/** Including the ones that are too light to scan on white as chosen. */
const AWKWARD_BRANDS = ["#fbbf24", "#a3e635", "#22d3ee", "#f9a8d4", "#e5e7eb", "#ffffff"];

const MIDDLES: SimpleMiddle[] = [
  { kind: "none" },
  { kind: "letters", text: "G" },
  { kind: "letters", text: "GH" },
  { kind: "letters", text: "GHC" },
  { kind: "letters", text: "RCCG" },
  { kind: "logo", url: "https://res.cloudinary.com/demo/image/upload/logo.png" },
];

const DESTINATIONS = [
  "https://flockinsight.com/l/give",
  "https://example.church/give",
  "https://example.church/first-timer-welcome-form",
  "https://docs.google.com/forms/d/e/1FAIpQLSdXYZ-very-long-form-id-abcdef/viewform",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijklmnop&index=7",
];

function build(choice: SimpleChoice, text: string) {
  const res = buildSimple(text, choice);
  expect(res.ok, res.ok ? "" : `${text}: ${res.error}`).toBe(true);
  if (!res.ok) throw new Error(res.error);
  return res;
}

/* ============================================================
 * The sweep
 * ========================================================== */

describe("every choice a church can make", () => {
  it("scans — no combination comes out blocked", () => {
    let total = 0;
    const blocked: string[] = [];

    for (const style of SIMPLE_STYLES) {
      for (const colour of [...BRANDS, ...AWKWARD_BRANDS]) {
        for (const middle of MIDDLES) {
          for (const caption of ["", "SCAN TO GIVE"]) {
            const choice: SimpleChoice = { style, colour, middle, caption };
            const res = build(choice, DESTINATIONS[0]);
            const check = analyse(res.symbol, res.design);
            total++;
            if (!check.scannable) {
              blocked.push(
                `${style}/${colour}/${middle.kind}${caption ? "/caption" : ""}: ` +
                  check.findings
                    .filter((f) => f.level === "blocker")
                    .map((f) => f.key)
                    .join(","),
              );
            }
          }
        }
      }
    }

    expect(total).toBeGreaterThan(400);
    expect(blocked, `${blocked.length} of ${total} blocked`).toEqual([]);
    // 864 combinations at a few milliseconds each. The sweep is slow because
    // it is wide, not because a build is slow — `_perf` measures the build.
  }, 60_000);

  it("scans for every length of destination, with a logo in the middle", () => {
    // The combination that failed most often before: something in the middle
    // AND a long address, because both want the same codewords.
    for (const text of DESTINATIONS) {
      for (const middle of MIDDLES) {
        for (const style of SIMPLE_STYLES) {
          const res = build({ ...DEFAULT_CHOICE, style, middle }, text);
          const check = analyse(res.symbol, res.design);
          expect(
            check.scannable,
            `${style} / ${middle.kind} / ${text.length} chars: ` +
              check.findings.map((f) => `${f.level}:${f.key}`).join(" "),
          ).toBe(true);
        }
      }
    }
  }, 60_000);

  it("leaves no warning either, for the colours a church is offered", () => {
    /*
     * Stricter than "scannable", and the stricter bar is the point: a church
     * choosing from the swatch row should never see "test a print". The
     * awkward colours are excluded here because those are typed in by hand —
     * they are made to scan, but the fix can only go so far with a colour
     * that started at 1.1:1.
     */
    const noisy: string[] = [];
    for (const style of SIMPLE_STYLES) {
      for (const colour of BRANDS) {
        for (const middle of MIDDLES) {
          const res = build({ ...DEFAULT_CHOICE, style, colour, middle }, DESTINATIONS[1]);
          const check = analyse(res.symbol, res.design);
          const warnings = check.findings.filter((f) => f.level !== "note");
          if (warnings.length > 0) {
            noisy.push(`${style}/${colour}/${middle.kind}: ${warnings.map((f) => f.key).join(",")}`);
          }
        }
      }
    }
    expect(noisy, noisy.join(" | ")).toEqual([]);
  }, 60_000);

  it("renders every combination without a broken number in the markup", () => {
    for (const style of SIMPLE_STYLES) {
      for (const middle of MIDDLES) {
        const res = build({ ...DEFAULT_CHOICE, style, middle, caption: "SCAN ME" }, DESTINATIONS[0]);
        const svg = renderSvg(res.symbol, res.design, { title: "x" });
        expect(svg, `${style}/${middle.kind}`).not.toMatch(/NaN|Infinity|undefined/);
        expect(svg.startsWith("<svg ")).toBe(true);
      }
    }
  });
});

/* ============================================================
 * What it changed, and whether it said so
 * ========================================================== */

describe("reporting what it changed", () => {
  it("says nothing when nothing needed changing", () => {
    // Black, no middle: there is nothing to fix, so there should be no notice.
    const res = build({ ...DEFAULT_CHOICE, colour: "#000000" }, DESTINATIONS[0]);
    expect(res.changes).toEqual([]);
  });

  it("darkens a colour that is too light, and keeps it the same colour", () => {
    const res = build({ ...DEFAULT_CHOICE, colour: "#fbbf24" }, DESTINATIONS[0]);
    const change = res.changes.find((c) => c.key === "colour");
    expect(change).toBeDefined();
    expect(change!.text).toContain("darker shade");

    const used = (res.design.fill as { color: string }).color;
    expect(used).not.toBe("#fbbf24");
    expect(contrastRatio(used, "#ffffff")).toBeGreaterThanOrEqual(4.5);

    // The same hue — a darker amber, not black and not a different colour.
    const before = hexToHsl("#fbbf24");
    const after = hexToHsl(used);
    expect(Math.abs(after.h - before.h)).toBeLessThan(0.03);
    expect(after.l).toBeLessThan(before.l);
    expect(after.s).toBeGreaterThan(0.3);
  });

  it("turns the correction up and the grid denser for a middle, and says which", () => {
    const res = build({ ...DEFAULT_CHOICE, middle: { kind: "letters", text: "GHC" } }, DESTINATIONS[0]);
    const keys = res.changes.map((c) => c.key);
    expect(keys).toContain("correction");
    expect(res.design.ecLevel).toBe("H");
    const grid = res.changes.find((c) => c.key === "grid");
    if (grid) expect(grid.text).toContain("squares across");
  });

  it("gives each change one short sentence a church can act on or ignore", () => {
    const res = build(
      { ...DEFAULT_CHOICE, colour: "#a3e635", middle: { kind: "letters", text: "RCCG" } },
      DESTINATIONS[3],
    );
    expect(res.changes.length).toBeGreaterThan(0);
    for (const c of res.changes) {
      expect(c.text.length, c.key).toBeGreaterThan(30);
      expect(c.text.length, c.key).toBeLessThan(220);
      // Written as something we did, not as something wrong with their choice.
      expect(c.text.startsWith("We ") || c.text.startsWith("What "), c.text).toBe(true);
    }
  });

  it("never reports a change it did not make", () => {
    const keys = build({ ...DEFAULT_CHOICE, colour: "#11182a" }, DESTINATIONS[0]).changes.map(
      (c) => c.key,
    );
    expect(keys).not.toContain("colour");
    expect(keys).not.toContain("middle-smaller");
    expect(keys).not.toContain("middle-removed");
  });

  it("does not report the same change twice", () => {
    for (const middle of MIDDLES) {
      const res = build({ ...DEFAULT_CHOICE, colour: "#22d3ee", middle }, DESTINATIONS[2]);
      const keys = res.changes.map((c) => c.key);
      expect(new Set(keys).size, keys.join(",")).toBe(keys.length);
    }
  });
});

/* ============================================================
 * Its limits, honestly
 * ========================================================== */

describe("when it genuinely cannot", () => {
  it("refuses text too long for any QR code, naming the way out", () => {
    const res = buildSimple("x".repeat(5000), DEFAULT_CHOICE);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("too long");
      expect(res.error).toContain("short link");
    }
  });

  it("refuses an empty payload rather than drawing nothing", () => {
    expect(buildSimple("", DEFAULT_CHOICE)).toMatchObject({ ok: false });
  });

  it("keeps the middle even on a very long payload, and still scans", () => {
    /*
     * This test was written expecting the middle to be DROPPED, and the
     * measurement said otherwise: a long payload makes a big grid, a big grid
     * has far more codewords, and a middle that is a fixed share of the width
     * therefore costs proportionally the same while having much more
     * redundancy to spend. Long payloads are easier for a logo, not harder.
     *
     * Kept as the assertion of what actually happens. `middle-removed` stays
     * in the code as the floor of the ladder, and is not reachable from the
     * simple panel — which is the right place for an unreachable fallback.
     */
    const huge = `https://example.church/${"a".repeat(1200)}`;
    const res = buildSimple(huge, {
      ...DEFAULT_CHOICE,
      middle: { kind: "letters", text: "GHC" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.design.centre.type).toBe("monogram");
    expect(analyse(res.symbol, res.design).scannable).toBe(true);
  });

  it("never grows the middle beyond what was asked for", () => {
    const res = build({ ...DEFAULT_CHOICE, middle: { kind: "letters", text: "GH" } }, DESTINATIONS[0]);
    if (res.design.centre.type !== "none") {
      expect(res.design.centre.size).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });
});

/* ============================================================
 * Determinism, because a preview that moves is unusable
 * ========================================================== */

describe("stability", () => {
  it("gives the same answer every time for the same choice", () => {
    const choice: SimpleChoice = {
      ...DEFAULT_CHOICE,
      colour: "#0284c7",
      middle: { kind: "letters", text: "GH" },
      caption: "SCAN ME",
    };
    const a = build(choice, DESTINATIONS[0]);
    const b = build(choice, DESTINATIONS[0]);
    expect(a.design).toEqual(b.design);
    expect(a.changes).toEqual(b.changes);
    expect(Array.from(a.symbol.modules)).toEqual(Array.from(b.symbol.modules));
  });

  it("is idempotent — fixing a fixed design changes nothing further", () => {
    for (const middle of MIDDLES) {
      for (const colour of [...BRANDS, ...AWKWARD_BRANDS]) {
        const first = build({ ...DEFAULT_CHOICE, colour, middle }, DESTINATIONS[2]);
        const again = autoFix(DESTINATIONS[2], first.design);
        expect("error" in again, `${colour}/${middle.kind}`).toBe(false);
        if ("error" in again) continue;
        expect(again.changes, `${colour}/${middle.kind}`).toEqual([]);
        expect(again.design).toEqual(first.design);
      }
    }
  }, 60_000);
});

/* ============================================================
 * The choice model
 * ========================================================== */

describe("a stored choice", () => {
  it("falls back rather than accepting nonsense", () => {
    expect(normaliseChoice(null)).toEqual(DEFAULT_CHOICE);
    expect(normaliseChoice({ style: "spiral" }).style).toBe(DEFAULT_CHOICE.style);
    expect(normaliseChoice({ colour: "chartreuse" }).colour).toBe(DEFAULT_CHOICE.colour);
    expect(normaliseChoice({ middle: { kind: "nonsense" } }).middle).toEqual({ kind: "none" });
  });

  it("round-trips through storage unchanged", () => {
    for (const style of SIMPLE_STYLES) {
      for (const middle of MIDDLES) {
        const choice: SimpleChoice = { style, colour: "#0284c7", middle, caption: "HI" };
        expect(normaliseChoice(JSON.parse(JSON.stringify(choice)))).toEqual(choice);
      }
    }
  });

  it("treats an empty middle as no middle, so a half-filled form draws", () => {
    // Choosing "letters" and not typing any yet must not blank the preview.
    expect(designFor({ ...DEFAULT_CHOICE, middle: { kind: "letters", text: "" } }).centre.type).toBe(
      "none",
    );
    expect(designFor({ ...DEFAULT_CHOICE, middle: { kind: "logo", url: "" } }).centre.type).toBe(
      "none",
    );
  });

  it("always puts the code on white, with the standard quiet zone", () => {
    for (const style of SIMPLE_STYLES) {
      const design = designFor({ ...DEFAULT_CHOICE, style });
      expect(design.background).toEqual({ type: "solid", color: "#ffffff" });
      expect(design.margin).toBe(4);
      expect(design.moduleScale).toBe(1);
    }
  });
});

describe("reopening a saved code", () => {
  it("recovers all four choices from the finished design", () => {
    /*
     * A saved code stores the design the auto-fix produced, not the choice, so
     * this round trip is what makes the panel show the right thing when
     * somebody opens a code they made last year.
     */
    for (const style of SIMPLE_STYLES) {
      for (const colour of BRANDS) {
        for (const middle of MIDDLES) {
          for (const caption of ["", "SCAN TO GIVE"]) {
            const choice: SimpleChoice = { style, colour, middle, caption };
            const res = build(choice, DESTINATIONS[1]);
            const back = choiceFromDesign(res.design);

            expect(back.style, `${style}/${middle.kind}`).toBe(style);
            expect(back.caption).toBe(caption);
            expect(back.middle.kind).toBe(middle.kind);
            if (middle.kind === "letters" && back.middle.kind === "letters") {
              expect(back.middle.text).toBe(middle.text);
            }
            if (middle.kind === "logo" && back.middle.kind === "logo") {
              expect(back.middle.url).toBe(middle.url);
            }
            /*
             * The colour may have been darkened by the fix. What matters is
             * that what comes back is the colour the code was DRAWN in, so
             * reopening and saving again changes nothing \u2014 otherwise every
             * open-and-save would darken it one step further.
             */
            expect(choiceFromDesign(build(back, DESTINATIONS[1]).design)).toEqual(back);
          }
        }
      }
    }
  }, 60_000);

  it("gives every style a distinguishable set of shapes", () => {
    // Two styles sharing their shapes makes the round trip above impossible.
    // `classic` and `bold` did share them, which is how that was found.
    const seen = new Map<string, string>();
    for (const style of SIMPLE_STYLES) {
      const d = designFor({ ...DEFAULT_CHOICE, style });
      const key = `${d.module}|${d.eyeFrame}|${d.eyeBall}`;
      expect(seen.get(key), `${style} shares its shapes with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, style);
    }
  });

  it("falls back to a usable style for a design it does not recognise", () => {
    const exotic = normaliseDesign({
      module: "heart",
      eyeFrame: "flower",
      eyeBall: "star",
      fill: { type: "rings", colors: ["#be123c", "#5b3df5"] },
    });
    const back = choiceFromDesign(exotic);
    expect(SIMPLE_STYLES).toContain(back.style);
    expect(back.colour).toMatch(/^#[0-9a-f]{3,6}$/);
    // And it still builds something that scans.
    expect(buildSimple(DESTINATIONS[0], back).ok).toBe(true);
  });
});

/* ============================================================
 * The colour helper on its own
 * ========================================================== */

describe("moving a colour", () => {
  it("round-trips through HSL", () => {
    for (const hex of [...BRANDS, "#000000", "#ffffff", "#7f7f7f"]) {
      const back = hslToHex(hexToHsl(hex));
      // Within one step of 8-bit rounding on each channel.
      expect(contrastRatio(back, hex), hex).toBeLessThan(1.05);
    }
  });

  it("reaches the target for anything that can", () => {
    for (const hex of [...BRANDS, ...AWKWARD_BRANDS]) {
      const fixed = adjustForContrast(hex, "#ffffff", 4.5);
      expect(contrastRatio(fixed, "#ffffff"), `${hex} -> ${fixed}`).toBeGreaterThanOrEqual(4.49);
    }
  });

  it("leaves a colour that already clears the target completely alone", () => {
    expect(adjustForContrast("#11182a", "#ffffff", 4.5)).toBe("#11182a");
    expect(adjustForContrast("#000000", "#ffffff", 4.5)).toBe("#000000");
  });

  it("lightens instead of darkening when the background is dark", () => {
    const fixed = adjustForContrast("#334155", "#11182a", 4.5);
    expect(hexToHsl(fixed).l).toBeGreaterThan(hexToHsl("#334155").l);
    expect(contrastRatio(fixed, "#11182a")).toBeGreaterThanOrEqual(4.49);
  });
});

/* ============================================================
 * Confidence, as the UI will show it
 * ========================================================== */

describe("what the badge says", () => {
  it("never says blocked, and never says test-a-print, for an offered colour", () => {
    for (const style of SIMPLE_STYLES) {
      for (const middle of MIDDLES) {
        const res = build({ ...DEFAULT_CHOICE, style, colour: "#5b3df5", middle }, DESTINATIONS[1]);
        const verdict = confidenceOf(analyse(res.symbol, res.design));
        expect(["good", "excellent"], `${style}/${middle.kind} -> ${verdict}`).toContain(verdict);
      }
    }
  });

  it("keeps the structural floor it was given", () => {
    const res = build({ ...DEFAULT_CHOICE, middle: { kind: "letters", text: "GHC" } }, DESTINATIONS[0]);
    expect(res.symbol.version).toBeGreaterThanOrEqual(structuralMinVersion(res.design));
    // And the encoded text is still exactly what was asked for.
    const direct = encodeQr(DESTINATIONS[0], {
      ecLevel: res.design.ecLevel,
      minVersion: res.design.minVersion,
    });
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.symbol.text).toBe(DESTINATIONS[0]);
  });
});
