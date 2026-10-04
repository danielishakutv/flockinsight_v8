import { describe, expect, it } from "vitest";
import {
  coverCrop,
  fitWithin,
  normalisePreset,
  orientationOf,
  outputName,
  placeWatermark,
  placementKeyFor,
  safeFilePart,
  savingLabel,
  studioExpiry,
  zipName,
  DEFAULT_PLACEMENT,
} from "./image-studio";

const PHOTO = { width: 4000, height: 3000 }; // landscape, 4:3
const TALL = { width: 3000, height: 4000 }; // portrait
const LOGO = { width: 400, height: 200 }; // wide logo, 2:1

describe("orientation", () => {
  it("reads the three shapes", () => {
    expect(orientationOf(4000, 3000)).toBe("landscape");
    expect(orientationOf(3000, 4000)).toBe("portrait");
    expect(orientationOf(1080, 1080)).toBe("square");
  });

  /*
   * A square has no long edge to lean on, and in practice a square crop is for
   * social media where the landscape corner placement is what people expect.
   */
  it("sends a square photo to the landscape settings", () => {
    expect(placementKeyFor(1080, 1080)).toBe("landscape");
    expect(placementKeyFor(3000, 4000)).toBe("portrait");
  });
});

describe("placeWatermark", () => {
  it("sizes the logo from the photo's width and keeps its aspect ratio", () => {
    const box = placeWatermark(PHOTO, LOGO, {
      anchor: "bottom-right",
      sizePct: 20,
      marginPct: 0,
      opacity: 100,
    });
    expect(box.width).toBe(800); // 20% of 4000
    expect(box.height).toBe(400); // 2:1 logo, never stretched
    expect(box.x).toBe(4000 - 800);
    expect(box.y).toBe(3000 - 400);
  });

  it("centres on the centre anchor", () => {
    const box = placeWatermark(PHOTO, LOGO, {
      anchor: "center",
      sizePct: 10,
      marginPct: 5,
      opacity: 100,
    });
    expect(box.x).toBe((4000 - 400) / 2);
    expect(box.y).toBe((3000 - 200) / 2);
  });

  it("measures the margin from the SHORT side, so it looks the same either way", () => {
    // 4% of 3000 (the short side) = 120, on a landscape photo…
    const land = placeWatermark(PHOTO, LOGO, {
      anchor: "top-left",
      sizePct: 10,
      marginPct: 4,
      opacity: 100,
    });
    expect(land.x).toBeCloseTo(120);
    expect(land.y).toBeCloseTo(120);
    // …and 4% of 3000 again on the portrait one, because that is ITS short side.
    const port = placeWatermark(TALL, LOGO, {
      anchor: "top-left",
      sizePct: 10,
      marginPct: 4,
      opacity: 100,
    });
    expect(port.x).toBeCloseTo(120);
    expect(port.y).toBeCloseTo(120);
  });

  /*
   * The bug this prevents: a tall crest asked for at "30% of the width" on a
   * portrait photo works out taller than the photo, and would hang off both
   * ends. It is sized down by height instead, keeping its shape.
   */
  it("shrinks a very tall logo to fit the photo's height", () => {
    const crest = { width: 200, height: 1000 }; // 1:5
    const box = placeWatermark(TALL, crest, {
      anchor: "center",
      sizePct: 60,
      marginPct: 5,
      opacity: 100,
    });
    expect(box.height).toBeLessThanOrEqual(TALL.height);
    expect(box.y).toBeGreaterThanOrEqual(0);
    // Aspect preserved: 1:5 throughout.
    expect(box.height / box.width).toBeCloseTo(5, 1);
  });

  it("never lets the logo hang off the edge", () => {
    for (const anchor of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "center",
    ] as const) {
      const box = placeWatermark(PHOTO, LOGO, {
        anchor,
        sizePct: 95,
        marginPct: 30,
        opacity: 100,
      });
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHOTO.width + 0.001);
      expect(box.y + box.height).toBeLessThanOrEqual(PHOTO.height + 0.001);
    }
  });

  it("survives a nonsense placement rather than producing NaN", () => {
    const box = placeWatermark(PHOTO, LOGO, {
      anchor: "bottom-right",
      sizePct: Number.NaN,
      marginPct: -10,
      opacity: 100,
    });
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.width)).toBe(true);
    expect(box.width).toBeGreaterThan(0);
  });
});

describe("fitWithin", () => {
  it("scales a big photo down on its longest edge", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  /*
   * Enlarging invents pixels: a bigger file, a blurrier picture. The one thing
   * a "quality preserved" promise cannot survive.
   */
  it("never scales up", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("leaves it alone when there is no limit", () => {
    expect(fitWithin(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
  });
});

describe("coverCrop", () => {
  it("takes a centred slice of a wide photo for a square", () => {
    const box = coverCrop(4000, 3000, 1);
    expect(box).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it("takes a centred slice of a tall photo for a wide ratio", () => {
    const box = coverCrop(3000, 4000, 16 / 9);
    expect(box.width).toBe(3000);
    expect(box.height).toBe(Math.round(3000 / (16 / 9)));
    expect(box.y).toBe(Math.round((4000 - box.height) / 2));
  });

  it("does nothing when the photo is already that shape", () => {
    expect(coverCrop(1080, 1080, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
    });
  });

  it("does nothing for 'as taken'", () => {
    expect(coverCrop(4000, 3000, 0)).toEqual({
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    });
  });
});

describe("normalisePreset", () => {
  it("fills in everything from nothing", () => {
    const p = normalisePreset(undefined);
    expect(p.placement.portrait).toEqual(DEFAULT_PLACEMENT.portrait);
    expect(p.placement.landscape).toEqual(DEFAULT_PLACEMENT.landscape);
    expect(p.quality).toBe(90);
    expect(p.format).toBe("image/webp");
  });

  it("clamps values a hand-edited row could carry", () => {
    const p = normalisePreset({
      placement: {
        landscape: { anchor: "nowhere", sizePct: 9000, marginPct: -5, opacity: 0 },
      },
      quality: 300,
      text: { enabled: true, text: "x".repeat(400), color: "red", sizePct: 99 },
      size: "nonsense",
      aspect: "nonsense",
      format: "image/gif",
    });
    expect(p.placement.landscape.anchor).toBe(DEFAULT_PLACEMENT.landscape.anchor);
    expect(p.placement.landscape.sizePct).toBe(100);
    expect(p.placement.landscape.marginPct).toBe(0);
    expect(p.placement.landscape.opacity).toBe(5);
    expect(p.quality).toBe(100);
    expect(p.text.text.length).toBe(120);
    expect(p.text.color).toBe("#ffffff"); // only #rrggbb is accepted
    expect(p.text.sizePct).toBe(20);
    expect(p.size).toBe("social");
    expect(p.aspect).toBe("as-is");
    expect(p.format).toBe("image/webp");
  });

  it("keeps a good preset intact", () => {
    const p = normalisePreset({
      placement: {
        portrait: { anchor: "top-left", sizePct: 25, marginPct: 6, opacity: 70 },
        landscape: { anchor: "center", sizePct: 12, marginPct: 3, opacity: 60 },
      },
      text: {
        enabled: true,
        text: "Sunday Service",
        anchor: "bottom-left",
        sizePct: 5,
        color: "#ff0000",
        backdrop: false,
        opacity: 80,
      },
      size: "print",
      aspect: "square",
      quality: 95,
      format: "image/jpeg",
    });
    expect(p.placement.portrait.anchor).toBe("top-left");
    expect(p.text.text).toBe("Sunday Service");
    expect(p.text.color).toBe("#ff0000");
    expect(p.size).toBe("print");
    expect(p.format).toBe("image/jpeg");
  });
});

describe("file names", () => {
  it("keeps the original name so a batch can be matched back", () => {
    expect(outputName("IMG_4821.JPG", "image/webp")).toBe("IMG_4821-branded.webp");
    expect(outputName("harvest 2026.png", "image/jpeg")).toBe(
      "harvest-2026-branded.jpg",
    );
  });

  it("makes a church's real name safe on Windows and Unix", () => {
    // Windows refuses \ / : * ? " < > | and a leading dot hides the file.
    expect(safeFilePart('St. Peter\'s / Mary"s: *the* church?')).toBe(
      // An illegal character becomes a separator (Mary"s → Mary-s); a merely
      // decorative one is dropped (Peter's → Peters).
      "St.-Peters-Mary-s-the-church",
    );
    expect(safeFilePart("...hidden")).toBe("hidden");
    expect(safeFilePart("Çedar Ìkeja")).toBe("Cedar-Ikeja");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(outputName("???.jpg", "image/webp")).toBe("photo-branded.webp");
    expect(zipName("???")).toMatch(/^church-photos-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it("stamps the zip with the church and the date", () => {
    expect(zipName("Grace Chapel", new Date("2026-10-04T09:00:00Z"))).toBe(
      "Grace-Chapel-photos-2026-10-04.zip",
    );
  });
});

describe("housekeeping", () => {
  it("expires a saved copy 30 days out", () => {
    const from = new Date("2026-10-04T12:00:00Z");
    const until = studioExpiry(from);
    expect(Math.round((until.getTime() - from.getTime()) / 86_400_000)).toBe(30);
  });

  it("says what was saved in words a person reads", () => {
    expect(savingLabel(4_200_000, 480_000)).toBe("4.0MB → 469KB (89% smaller)");
    // A file that grew says so by omission rather than claiming "-12% smaller".
    expect(savingLabel(1000, 2000)).toBe("1000B → 2KB");
  });
});
