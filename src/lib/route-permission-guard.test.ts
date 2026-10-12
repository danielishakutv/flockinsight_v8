import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A route handler is its own entry point. No page guard and no layout runs
 * before it, so `requireChurch()` alone only proves somebody belongs to the
 * church — not that their role may see what the route returns. That is how
 * /giving/export, /members/export and both attendance exports handed the
 * whole ledger and register to any staff login while their pages refused the
 * same person.
 *
 * So: any route.ts that calls requireChurch() must also ask a permission
 * question. A route that genuinely needs none goes in ALLOWED with the reason.
 */
const ALLOWED: Record<string, string> = {};

const PERMISSION_CALL = /\b(can|canAny|requireCan|requireCanAny|getAccess)\(/;
const REQUIRE_CHURCH_CALL = /\brequireChurch\(\)/;

/** Comments mention requireChurch() too ("it never runs here"); read code only. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts" || name === "route.tsx") out.push(p);
  }
  return out;
}

describe("church route handlers check a permission", () => {
  it("has no route that stops at requireChurch()", () => {
    const appDir = path.resolve(import.meta.dirname, "../app");
    const offenders = walk(appDir, [])
      .filter((f) => {
        const src = code(readFileSync(f, "utf8"));
        return REQUIRE_CHURCH_CALL.test(src) && !PERMISSION_CALL.test(src);
      })
      .map((f) => path.relative(appDir, f).split(path.sep).join("/"))
      .filter((rel) => !(rel in ALLOWED));
    expect(offenders).toEqual([]);
  });
});
