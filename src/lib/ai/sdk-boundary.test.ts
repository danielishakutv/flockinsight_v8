import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The boundary that makes runAi the only way out:
 *   - only lib/ai/client.ts imports the SDK;
 *   - only lib/ai/run-ai.ts imports lib/ai/client;
 *   - every non-pure lib/ai module is server-only;
 *   - no component imports run-ai, client or budget.
 * A source scan, because a convention nobody checks is a convention that
 * quietly stops holding the first time somebody is in a hurry.
 */

const SRC = join(import.meta.dirname, "..", "..");

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      files(full, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");
const ALL = files(SRC).filter((f) => !/\.test\.tsx?$/.test(f));
const src = (f: string) => readFileSync(f, "utf8");

function importers(pattern: RegExp): string[] {
  return ALL.filter((f) => pattern.test(src(f))).map(rel);
}

/** Pure modules: no server-only, no database, loaded by vitest directly. */
const PURE = new Set([
  "lib/ai/vocab.ts",
  "lib/ai/serialiser.ts",
  "lib/ai/safe-text.ts",
  "lib/ai/prompts.ts",
  "lib/ai/pricing.ts",
  "lib/ai/budget-rules.ts",
  "lib/ai/run-ai-rules.ts",
  "lib/ai/church-facts-shared.ts",
  "lib/ai/platform-facts-shared.ts",
  "lib/ai/ai-shared.ts",
  "lib/ai/settings-rules.ts",
]);

describe("the AI SDK boundary", () => {
  it("scans a meaningful number of files", () => {
    expect(ALL.length).toBeGreaterThan(100);
  });

  it("only lib/ai/client.ts imports @anthropic-ai/sdk", () => {
    expect(importers(/from\s+["']@anthropic-ai\/sdk[^"']*["']|require\(["']@anthropic-ai\/sdk/)).toEqual([
      "lib/ai/client.ts",
    ]);
  });

  it("only lib/ai/run-ai.ts imports lib/ai/client", () => {
    expect(importers(/from\s+["'](?:@\/lib\/ai\/client|\.\/client)["']/)).toEqual(["lib/ai/run-ai.ts"]);
  });

  it("every non-pure lib/ai module starts with import \"server-only\"", () => {
    const ai = ALL.filter((f) => rel(f).startsWith("lib/ai/") && !rel(f).endsWith(".db-check.ts"));
    expect(ai.length).toBeGreaterThan(10);
    for (const f of ai) {
      const name = rel(f);
      if (PURE.has(name)) {
        expect(src(f), `${name} is listed as pure`).not.toMatch(/import\s+["']server-only["']/);
        expect(src(f), `${name} is listed as pure`).not.toMatch(/from\s+["']@\/db["']/);
      } else {
        expect(src(f).trimStart().startsWith('import "server-only";'), name).toBe(true);
      }
    }
  });

  it("no component imports run-ai, client or budget", () => {
    const bad = ALL.filter((f) => rel(f).startsWith("components/")).filter((f) =>
      /from\s+["']@\/lib\/ai\/(run-ai|client|budget)["']/.test(src(f)),
    );
    expect(bad.map(rel)).toEqual([]);
  });
});
