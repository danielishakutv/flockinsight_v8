import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing may sit underneath the phone's bottom nav.
 *
 * Below lg the app shell always draws MobileNav as `fixed inset-x-0 bottom-0
 * z-30`, about 61px of tabs plus the safe-area inset, with the round Record
 * button's top 4rem above the bar's bottom edge. The form builder's "Save
 * form" bar and the devotional editor's "Save draft / Schedule / Send now" bar
 * were ALSO `fixed inset-x-0 bottom-0`, at z-10 — so on every phone the nav
 * covered them, a tap on Save landed on the nav, and neither editor could be
 * saved, scheduled or sent from a phone. Nothing errored; the button was
 * simply under something else.
 *
 * The rule this holds: a className that pins something to `bottom-0` with
 * `fixed`, unprefixed (so it applies on a phone), must be either the nav
 * itself (`lg:hidden`) or a sheet/overlay that deliberately covers it
 * (`z-50`). An action bar uses `bottom-[calc(var(--mobile-nav-clearance)+…)]`
 * below lg instead (globals.css), and `lg:bottom-0` above it.
 */

const SRC = join(import.meta.dirname, "..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Every string literal that looks like a class list. */
const CLASS_STRING = /"([^"\n]*)"|`([^`]*)`/g;

/**
 * Each `className={…}` expression with every string inside it pooled, so a
 * class list split across `cn("fixed", "bottom-0 …")` arguments is judged as
 * the one list it renders as. A lone literal only sees its own half.
 */
function classExpressions(text: string): { at: number; tokens: string[] }[] {
  const out: { at: number; tokens: string[] }[] = [];
  for (const m of text.matchAll(/className=\{/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    const body = text.slice(start, i - 1);
    const tokens = [...body.matchAll(CLASS_STRING)].flatMap((s) =>
      (s[1] ?? s[2] ?? "").split(/\s+/),
    );
    out.push({ at: m.index, tokens });
  }
  return out;
}

function pinnedUnderNav(tokens: string[]): boolean {
  if (!tokens.includes("fixed") || !tokens.includes("bottom-0")) return false;
  return !tokens.includes("lg:hidden") && !tokens.includes("z-50");
}

function offenders(): string[] {
  const found = new Set<string>();
  for (const file of tsxFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join("/");
    // The primitives (sheet, drawer, toaster) are overlays by construction.
    if (rel.startsWith("components/ui/")) continue;
    const text = readFileSync(file, "utf8");
    const lineOf = (at: number) => text.slice(0, at).split("\n").length;
    // A single literal (this also catches a class list kept in a const).
    for (const m of text.matchAll(CLASS_STRING)) {
      if (pinnedUnderNav((m[1] ?? m[2] ?? "").split(/\s+/))) {
        found.add(`${rel}:${lineOf(m.index)}`);
      }
    }
    // And a list assembled from several, as cn() does.
    for (const { at, tokens } of classExpressions(text)) {
      if (pinnedUnderNav(tokens)) found.add(`${rel}:${lineOf(at)}`);
    }
  }
  return [...found];
}

describe("fixed bottom bars on a phone", () => {
  it("nothing but the nav and its overlays is pinned to bottom-0 below lg", () => {
    expect(offenders()).toEqual([]);
  });

  it("sees a bar whose classes are split across cn() arguments", () => {
    const split = `<div className={cn("fixed inset-x-0", open && "bottom-0 z-20")} />`;
    expect(classExpressions(split).some((e) => pinnedUnderNav(e.tokens))).toBe(true);
    const overlay = `<div className={cn("fixed inset-x-0 bottom-0", "z-50")} />`;
    expect(classExpressions(overlay).some((e) => pinnedUnderNav(e.tokens))).toBe(false);
  });

  it.each(["components/forms/form-builder.tsx", "components/devotionals/devotional-editor.tsx"])(
    "%s stands its action bar above the nav",
    (rel) => {
      const text = readFileSync(join(SRC, rel), "utf8");
      expect(text).toContain(
        "bottom-[calc(var(--mobile-nav-clearance)+env(safe-area-inset-bottom))]",
      );
      expect(text).toContain("lg:bottom-0");
    },
  );

  it("the clearance the bars rely on clears the Record button, and no more", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const m = css.match(/--mobile-nav-clearance:\s*([\d.]+)rem;/);
    expect(m).not.toBeNull();
    // The Record circle (size-16, its -mt-6 inside an items-end wrapper) tops
    // out 4rem above the nav's bottom edge. Below that the bar sits on the
    // circle; well above it the page scrolls through a strip between the two.
    const rem = Number(m![1]);
    expect(rem).toBeGreaterThanOrEqual(4);
    expect(rem).toBeLessThanOrEqual(4.75);
    // If the button changes shape, the arithmetic above has to be redone.
    const nav = readFileSync(join(SRC, "components", "app", "mobile-nav.tsx"), "utf8");
    expect(nav).toMatch(/-mt-6 grid size-16/);
  });
});
