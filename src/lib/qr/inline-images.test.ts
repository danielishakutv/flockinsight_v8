/**
 * The logo has to be CARRIED by the markup, not referred to by it.
 *
 * These tests exist because the bug they cover was invisible: the preview
 * showed the logo, the download reported success, and the PNG came out with
 * Chrome's broken-image glyph in the middle of the code. Nothing threw. So the
 * thing to assert is not "it did not error" — it is that no `http` reference
 * survives into the design we hand a rasteriser.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_DESIGN, type QrDesign } from "@/lib/qr/design";
import {
  designImageUrls,
  inlineDesignImages,
  needsInlining,
} from "@/lib/qr/inline-images";

const LOGO = "https://res.cloudinary.com/demo/image/upload/logo.png";

function withLogo(url = LOGO): QrDesign {
  return {
    ...DEFAULT_DESIGN,
    centre: {
      type: "image",
      url,
      size: 0.2,
      shape: "circle",
      backdrop: true,
      backdropColor: "#ffffff",
    },
  };
}

/** A fetch that answers every request with the same body. */
function fetchReturning(body: Blob, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    blob: () => Promise.resolve(body),
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("designImageUrls", () => {
  it("finds a logo", () => {
    expect(designImageUrls(withLogo())).toEqual([LOGO]);
  });

  it("ignores one that is already inline, so nothing is fetched twice", () => {
    expect(designImageUrls(withLogo("data:image/png;base64,AAAA"))).toEqual([]);
    expect(needsInlining(withLogo("data:image/png;base64,AAAA"))).toBe(false);
  });

  it("finds a fill and a background as well as a centre", () => {
    const design: QrDesign = {
      ...withLogo(),
      fill: { type: "image", url: "https://example.org/a.png" },
      background: {
        type: "image",
        url: "https://example.org/b.png",
        scrim: 0.75,
        scrimColor: "#ffffff",
      },
    };
    expect(designImageUrls(design).sort()).toEqual(
      ["https://example.org/a.png", "https://example.org/b.png", LOGO].sort(),
    );
  });

  it("says a plain design needs nothing", () => {
    expect(needsInlining(DEFAULT_DESIGN)).toBe(false);
  });
});

describe("inlineDesignImages", () => {
  it("replaces the logo's URL with its bytes", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })),
    );
    const result = await inlineDesignImages(withLogo());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.centre.type).toBe("image");
    const url = result.design.centre.type === "image" ? result.design.centre.url : "";
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    // The actual assertion: nothing is left for a rasteriser to go and fetch.
    expect(designImageUrls(result.design)).toEqual([]);
  });

  it("does not touch a design with no images, and makes no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await inlineDesignImages(DEFAULT_DESIGN);
    expect(result.ok && result.design).toBe(DEFAULT_DESIGN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches each distinct URL once even when it is used twice", async () => {
    const fetchSpy = fetchReturning(new Blob([new Uint8Array([9])], { type: "image/png" }));
    vi.stubGlobal("fetch", fetchSpy);
    const design: QrDesign = { ...withLogo(), fill: { type: "image", url: LOGO } };
    const result = await inlineDesignImages(design);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("says so, and names the remedy, when the host blocks the read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const result = await inlineDesignImages(withLogo());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.url).toBe(LOGO);
    expect(result.error).toMatch(/upload the logo here/i);
  });

  it("reports a missing file with its status rather than as a CORS problem", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning(new Blob([], { type: "image/png" }), false, 404),
    );
    const result = await inlineDesignImages(withLogo());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("404");
  });

  it("refuses something that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning(new Blob(["<html>"], { type: "text/html" })),
    );
    const result = await inlineDesignImages(withLogo());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not an image/i);
  });

  it("handles a logo far too large for the one-line btoa everybody writes", async () => {
    // 300KB: `String.fromCharCode(...bytes)` overflows the stack well below this.
    const big = new Uint8Array(300_000).fill(0x41);
    vi.stubGlobal("fetch", fetchReturning(new Blob([big], { type: "image/png" })));
    const result = await inlineDesignImages(withLogo());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = result.design.centre.type === "image" ? result.design.centre.url : "";
    expect(url.length).toBeGreaterThan(400_000);
  });
});
