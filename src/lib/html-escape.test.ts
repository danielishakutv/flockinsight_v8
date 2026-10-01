import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "./html-escape";

describe("escapeHtml", () => {
  it("escapes every character that can break out of HTML", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;",
    );
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    // The bug this pins: escaping & last turns the "&" of "&lt;" into "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("closes a quoted attribute no matter which quote style is used", () => {
    const evil = `" onerror="alert(1)`;
    const rendered = `<img alt="${escapeHtml(evil)}">`;
    expect(rendered).not.toContain('alt="" onerror=');
    expect(rendered).toBe(
      '<img alt="&quot; onerror=&quot;alert(1)">',
    );
    const single = `' onerror='alert(1)`;
    expect(`<img alt='${escapeHtml(single)}'>`).not.toContain("' onerror='");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Grace Chapel, Abuja")).toBe("Grace Chapel, Abuja");
  });

  it("is idempotent in the sense that it never loses the original text", () => {
    const name = `Tom & Jerry's <Church>`;
    const out = escapeHtml(name);
    // Round-trips through a minimal unescape back to the original.
    const back = out
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
    expect(back).toBe(name);
  });
});

/**
 * The reason this file exists at all: there were seventeen private copies of
 * this function, in two different strengths. One is now shared, and this guard
 * fails the build if a new private copy appears instead of an import.
 */
describe("no private copies of escapeHtml", () => {
  const ROOT = join(import.meta.dirname, "..");
  const SELF = "lib/html-escape.ts";

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "migrations") continue;
        sourceFiles(full, out);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("defines it in exactly one place", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (rel === SELF) continue;
      const src = readFileSync(file, "utf8");
      if (/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+escapeHtml\s*\(/.test(src))
        offenders.push(rel);
      if (/\bconst\s+escapeHtml\s*=/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      offenders.length
        ? `escapeHtml is defined privately in:\n  ${offenders.join("\n  ")}\n` +
            `Import it from "@/lib/html-escape" instead — a second copy is how ` +
            `the two different versions came about last time.`
        : "",
    ).toEqual([]);
  });
});
