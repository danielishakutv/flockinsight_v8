import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN,
  MODULE_SHAPES,
  backgroundColors,
  contrastRatio,
  fillColors,
  hexChannels,
  initialsOf,
  isHexColor,
  luminance,
  normaliseDesign,
  type QrDesign,
} from "@/lib/qr/design";
import { encodeQr, type QrSymbol } from "@/lib/qr/encode";
import { centreBox, layoutFor, renderSvg, svgDataUrl } from "@/lib/qr/render";
import { analyse, confidenceOf } from "@/lib/qr/verify";

const URL = "https://flockinsight.com/l/sunday";

function symbolFor(design: QrDesign): QrSymbol {
  const res = encodeQr(URL, {
    ecLevel: design.ecLevel,
    minVersion: design.minVersion,
  });
  if (!res.ok) throw new Error(res.error);
  return res.symbol;
}

/* ============================================================
 * Colour
 * ========================================================== */

describe("colour", () => {
  it("accepts the two hex forms a colour input produces, and nothing else", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
    expect(isHexColor("#11182a")).toBe(true);
    expect(isHexColor("white")).toBe(false);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it("expands the short form rather than reading it as a long one", () => {
    expect(hexChannels("#fff")).toEqual([255, 255, 255]);
    expect(hexChannels("#f00")).toEqual([255, 0, 0]);
    expect(hexChannels("#11182a")).toEqual([17, 24, 42]);
  });

  it("reads nonsense as black instead of throwing", () => {
    // Callers include a render path that must never fail on a stored row.
    expect(hexChannels("not a colour")).toEqual([0, 0, 0]);
  });

  it("matches the published contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Symmetrical, whichever way round.
    expect(contrastRatio("#11182a", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#11182a"),
      9,
    );
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("knows which colours a fill can paint, and says nothing for a photograph", () => {
    expect(fillColors({ type: "solid", color: "#123456" })).toEqual(["#123456"]);
    expect(fillColors({ type: "linear", from: "#000000", to: "#ffffff", angle: 0 })).toEqual([
      "#000000",
      "#ffffff",
    ]);
    // Unknowable, and saying so is the point — see the finding in verify.ts.
    expect(fillColors({ type: "image", url: "x" })).toEqual([]);
  });

  it("treats a heavy veil over a photograph as a known colour, a light one as unknown", () => {
    expect(
      backgroundColors({ type: "image", url: "x", scrim: 0.95, scrimColor: "#ffffff" }),
    ).toEqual(["#ffffff"]);
    expect(
      backgroundColors({ type: "image", url: "x", scrim: 0.5, scrimColor: "#ffffff" }),
    ).toEqual([]);
  });

  it("assumes white behind a transparent code, which is the safe reading", () => {
    expect(backgroundColors({ type: "transparent" })).toEqual(["#ffffff"]);
  });
});

/* ============================================================
 * Normalising
 * ========================================================== */

describe("normalising a stored design", () => {
  it("returns the default for nothing at all", () => {
    expect(normaliseDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(normaliseDesign({})).toEqual(DEFAULT_DESIGN);
    expect(normaliseDesign("not an object")).toEqual(DEFAULT_DESIGN);
  });

  it("round-trips the default through storage unchanged", () => {
    expect(normaliseDesign(JSON.parse(JSON.stringify(DEFAULT_DESIGN)))).toEqual(
      DEFAULT_DESIGN,
    );
  });

  it("keeps the quiet zone at two modules or more, whatever is asked", () => {
    // Below two there is no border to speak of, and the code's edge and
    // whatever it is printed beside become the same thing.
    expect(normaliseDesign({ margin: 0 }).margin).toBe(2);
    expect(normaliseDesign({ margin: -8 }).margin).toBe(2);
    expect(normaliseDesign({ margin: 99 }).margin).toBe(10);
    expect(normaliseDesign({ margin: 4 }).margin).toBe(4);
  });

  it("keeps the veil over a background photograph at 0.35 or more", () => {
    // The one knob that refuses to go where it is pushed: with no veil the
    // preview is beautiful on a bright screen and the code cannot be read.
    const design = normaliseDesign({
      background: { type: "image", url: "x", scrim: 0, scrimColor: "#ffffff" },
    });
    expect(design.background).toMatchObject({ scrim: 0.35 });
  });

  it("caps the middle at 30% of the width", () => {
    const big = normaliseDesign({ centre: { type: "icon", icon: "cross", size: 0.9 } });
    expect(big.centre).toMatchObject({ size: 0.3 });
    const small = normaliseDesign({ centre: { type: "icon", icon: "cross", size: 0.01 } });
    expect(small.centre).toMatchObject({ size: 0.1 });
  });

  it("keeps module scale within the range the shapes were drawn for", () => {
    expect(normaliseDesign({ moduleScale: 0 }).moduleScale).toBe(0.55);
    expect(normaliseDesign({ moduleScale: 4 }).moduleScale).toBe(1);
  });

  it("falls back rather than accepting an unknown shape or level", () => {
    expect(normaliseDesign({ module: "spiral" }).module).toBe(DEFAULT_DESIGN.module);
    expect(normaliseDesign({ eyeFrame: "triangle" }).eyeFrame).toBe(DEFAULT_DESIGN.eyeFrame);
    expect(normaliseDesign({ ecLevel: "Z" }).ecLevel).toBe("M");
    expect(normaliseDesign({ fill: { type: "plaid" } }).fill).toEqual({
      type: "solid",
      color: "#11182a",
    });
  });

  it("replaces an invalid colour instead of letting it reach the markup", () => {
    // A colour the browser does not understand renders as black in some
    // engines and as nothing in others, which is a code that does not scan.
    expect(normaliseDesign({ fill: { type: "solid", color: "chartreuse" } }).fill).toEqual({
      type: "solid",
      color: "#11182a",
    });
    expect(normaliseDesign({ eyeFrameColor: "bogus" }).eyeFrameColor).toBeNull();
    expect(normaliseDesign({ eyeFrameColor: "#ABCDEF" }).eyeFrameColor).toBe("#abcdef");
  });

  it("accepts only an http, https or same-site image address", () => {
    /*
     * The one free-text field in a design that reaches the rendered markup, and
     * a design arrives from a jsonb column as well as from the designer. The
     * renderer escapes it too; this is so the question does not arise.
     */
    const ok = (url: string): string =>
      (normaliseDesign({ fill: { type: "image", url } }).fill as { url: string }).url;

    expect(ok("https://res.cloudinary.com/x/logo.png")).toBe(
      "https://res.cloudinary.com/x/logo.png",
    );
    expect(ok("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
    expect(ok("/uploads/logo.png")).toBe("/uploads/logo.png");

    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "//evil.example.com/x.png",
      'x" onload="alert(1)',
      "not a url",
      "",
    ]) {
      expect(ok(bad), bad).toBe("");
    }
  });

  it("keeps an image address out of the markup when it is rejected", () => {
    const design = normaliseDesign({
      ...DEFAULT_DESIGN,
      centre: {
        type: "image",
        url: "javascript:alert(1)",
        size: 0.2,
        shape: "circle",
        backdrop: true,
        backdropColor: "#ffffff",
      },
    });
    const svg = renderSvg(symbolFor(design), design);
    expect(svg).not.toContain("javascript");
    expect(svg).not.toContain("alert");
  });

  it("drops the ring colours that are not colours, keeping a usable set", () => {
    const design = normaliseDesign({
      fill: { type: "rings", colors: ["#ff0000", "nope", "#00ff00"] },
    });
    expect(design.fill).toEqual({ type: "rings", colors: ["#ff0000", "#00ff00"] });
    // All of them invalid falls back to a set that renders.
    const empty = normaliseDesign({ fill: { type: "rings", colors: ["nope"] } });
    expect(empty.fill).toMatchObject({ type: "rings" });
    expect((empty.fill as { colors: string[] }).colors.length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * Presets
 * ========================================================== */

describe("church initials", () => {
  it("takes the first letter of the words that carry meaning", () => {
    expect(initialsOf("Grace House Chapel")).toBe("GHC");
    expect(initialsOf("The Redeemed Christian Church of God")).toBe("RCC");
    expect(initialsOf("Winners")).toBe("W");
  });

  it("copes with punctuation, extra spaces and nothing at all", () => {
    expect(initialsOf("  St. Mary's   Cathedral  ")).toBe("SMC");
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });

  it("handles a non-Latin name rather than returning nothing", () => {
    expect(initialsOf("Ìjọ Mímọ́")).toBe("ÌM");
  });
});

/* ============================================================
 * Rendering
 * ========================================================== */

describe("rendering", () => {
  const design = DEFAULT_DESIGN;
  const symbol = symbolFor(design);

  it("is deterministic — the same input always gives the same markup", () => {
    // Which is what lets the preview be compared, cached, and measured.
    expect(renderSvg(symbol, design)).toBe(renderSvg(symbol, design));
  });

  it("gives two codes on one page different gradient ids", () => {
    // Otherwise the second code silently takes the first one's colours.
    const a = renderSvg(symbol, {
      ...design,
      fill: { type: "linear", from: "#000000", to: "#ff0000", angle: 0 },
    });
    const b = renderSvg(symbol, {
      ...design,
      fill: { type: "linear", from: "#000000", to: "#00ff00", angle: 0 },
    });
    const idOf = (svg: string): string => /id="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(idOf(a)).not.toBe(idOf(b));
    expect(idOf(a).length).toBeGreaterThan(2);
  });

  it("escapes anything a person typed", () => {
    const svg = renderSvg(symbol, {
      ...design,
      frame: {
        style: "bar",
        text: '<script>&"x"',
        position: "bottom",
        color: "#000000",
        textColor: "#ffffff",
      },
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;SCRIPT&gt;");
  });

  it("escapes a title, which comes from a church's own words", () => {
    const svg = renderSvg(symbol, design, { title: 'Grace & "Peace" <br>' });
    expect(svg).toContain("<title>Grace &amp; &quot;Peace&quot; &lt;br&gt;</title>");
  });

  it("sizes the viewBox from the symbol, the quiet zone and the frame", () => {
    const plain = layoutFor(symbol, { ...design, margin: 4, frame: { ...design.frame, style: "none" } });
    expect(plain.width).toBe(symbol.size + 8);
    expect(plain.height).toBe(symbol.size + 8);
    expect(plain.offsetX).toBe(4);
    expect(plain.caption).toBeNull();

    const captioned = layoutFor(symbol, {
      ...design,
      frame: { ...design.frame, style: "bar", text: "SCAN ME", position: "bottom" },
    });
    expect(captioned.width).toBe(symbol.size + 8);
    expect(captioned.height).toBeGreaterThan(captioned.width);
    expect(captioned.caption).not.toBeNull();
    // The caption sits OUTSIDE the quiet zone, never inside it.
    expect(captioned.caption!.y).toBeGreaterThanOrEqual(symbol.size + 8);
  });

  it("puts a top caption above the code, pushing the code down", () => {
    const top = layoutFor(symbol, {
      ...design,
      frame: { ...design.frame, style: "bar", text: "SCAN ME", position: "top" },
    });
    expect(top.caption!.y).toBe(0);
    expect(top.offsetY).toBeGreaterThan(design.margin);
  });

  it("adds no caption band for a frame with no words in it", () => {
    const blank = layoutFor(symbol, {
      ...design,
      frame: { ...design.frame, style: "bar", text: "   " },
    });
    expect(blank.caption).toBeNull();
    expect(blank.height).toBe(blank.width);
  });

  it("centres the middle overlay on the symbol, not on the whole image", () => {
    // With a caption the image is taller than it is wide; a logo centred on
    // the image instead of the code would sit low and cover the wrong modules.
    const withCaption: QrDesign = {
      ...design,
      centre: {
        type: "icon",
        icon: "cross",
        size: 0.2,
        shape: "circle",
        color: "#ffffff",
        backdropColor: "#000000",
      },
      frame: { ...design.frame, style: "bar", text: "GIVE", position: "bottom" },
    };
    const layout = layoutFor(symbol, withCaption);
    const box = centreBox(symbol, withCaption, layout)!;
    expect(box.x + box.size / 2).toBeCloseTo(layout.offsetX + symbol.size / 2, 6);
    expect(box.y + box.size / 2).toBeCloseTo(layout.offsetY + symbol.size / 2, 6);
  });

  it("draws one path for the modules, not one element each", () => {
    // A version-10 code has ~1,500 dark modules; as separate elements the
    // preview stutters on a mid-range phone and the file is five times larger.
    const svg = renderSvg(symbol, design);
    expect((svg.match(/<rect/g) ?? []).length).toBe(0);
    // The body, the eye frames and the eye balls: three paths, no more.
    expect((svg.match(/<path /g) ?? []).length).toBeLessThanOrEqual(4);
  });

  it("draws letters as text, one per dark module", () => {
    const letters: QrDesign = { ...design, module: "letters", letters: "GRACE" };
    const svg = renderSvg(symbol, letters);
    const count = (svg.match(/<text /g) ?? []).length;
    let dark = 0;
    for (let y = 0; y < symbol.size; y++) {
      for (let x = 0; x < symbol.size; x++) {
        if (symbol.modules[y * symbol.size + x] && symbol.roles[y * symbol.size + x] !== 1) {
          dark++;
        }
      }
    }
    expect(count).toBe(dark);
  });

  it("renders every module shape without producing a broken number", () => {
    for (const shape of MODULE_SHAPES) {
      for (const moduleScale of [0.55, 0.8, 1]) {
        const svg = renderSvg(symbol, {
          ...design,
          module: shape,
          moduleScale,
          letters: "XY",
        });
        expect(svg, `${shape} @ ${moduleScale}`).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it("omits the background entirely when it is transparent", () => {
    const svg = renderSvg(symbol, { ...design, background: { type: "transparent" } });
    // No full-size light rectangle, so the code can sit on anything.
    expect(svg).not.toContain('fill="#ffffff"');
  });

  it("makes a data URL a browser and a canvas both accept", () => {
    const url = svgDataUrl(renderSvg(symbol, design));
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(url).not.toContain("#");
    expect(decodeURIComponent(url.split(",")[1])).toContain("<svg");
  });

  it("puts pixel dimensions on the root when asked, keeping the aspect ratio", () => {
    const captioned: QrDesign = {
      ...design,
      frame: { ...design.frame, style: "bar", text: "SCAN ME" },
    };
    const layout = layoutFor(symbol, captioned);
    const svg = renderSvg(symbol, captioned, { pixelSize: 1000 });
    const height = Number(/height="([\d.]+)"/.exec(svg)![1]);
    expect(height).toBeCloseTo((1000 * layout.height) / layout.width, 1);
  });
});

describe("confidence", () => {
  it("reads as excellent for black on white with nothing in the middle", () => {
    const design = normaliseDesign({
      ...DEFAULT_DESIGN,
      fill: { type: "solid", color: "#000000" },
      background: { type: "solid", color: "#ffffff" },
      margin: 4,
    });
    expect(confidenceOf(analyse(symbolFor(design), design))).toBe("excellent");
  });
});
