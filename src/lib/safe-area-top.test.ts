import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A layout that draws its own header must start below the iPhone status bar.
 *
 * The root viewport is `viewportFit: "cover"` with a black-translucent status
 * bar, so an installed PWA is drawn behind the clock and the Dynamic Island.
 * The church app's layout padded for it; the platform admin's and the
 * partner portal's did not — their headers sat under the clock and the
 * battery, and on an iPhone the menu, help and sign-out buttons could not be
 * tapped at all. Nothing errors; a desktop browser and Android show nothing.
 *
 * The rule: a layout.tsx with a <header> reads env(safe-area-inset-top).
 */

const APP = join(import.meta.dirname, "..", "app");

function layouts(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) layouts(full, out);
    else if (entry.name === "layout.tsx") out.push(full);
  }
  return out;
}

describe("layouts with a header clear the status bar", () => {
  const withHeader = layouts(APP).filter((f) =>
    readFileSync(f, "utf8").includes("<header"),
  );

  it("finds the layouts it is guarding", () => {
    const names = withHeader.map((f) => relative(APP, f));
    expect(names).toEqual(
      expect.arrayContaining([
        join("superadmin", "layout.tsx"),
        join("partner", "layout.tsx"),
      ]),
    );
  });

  it.each(withHeader.map((f) => [relative(APP, f), f]))(
    "%s pads for env(safe-area-inset-top)",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toContain("env(safe-area-inset-top)");
    },
  );
});
