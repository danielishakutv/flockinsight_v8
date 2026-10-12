import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scriptSafeJson } from "./script-json";

describe("scriptSafeJson", () => {
  const payload = "</script><script>alert(1)</script>";

  it("leaves nothing that can close a <script> element", () => {
    const out = scriptSafeJson({ description: payload });
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
  });

  it("is still JSON that parses back to exactly the same value", () => {
    const data = {
      "@context": "https://schema.org",
      name: "Grace & Truth <Chapel>",
      description: payload,
      odd: "line\u2028sep\u2029para <!-- -->",
      sameAs: ["https://x.com/a?b=1&c=2"],
    };
    expect(JSON.parse(scriptSafeJson(data))).toEqual(data);
  });

  it("escapes the two JS line terminators JSON allows", () => {
    const out = scriptSafeJson("a\u2028b\u2029c");
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(out).toBe('"a\\u2028b\\u2029c"');
  });

  it("returns a string for undefined", () => {
    expect(scriptSafeJson(undefined)).toBe("null");
  });
});

/*
 * The sink was fixed in one component. A second raw JSON.stringify handed to
 * `__html` that someone writes later would reopen the same hole, so fail on
 * the shape.
 */
describe("no raw JSON.stringify into dangerouslySetInnerHTML", () => {
  function walk(dir: string, out: string[]) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("finds none in src/", () => {
    const root = path.resolve(import.meta.dirname, "..");
    // Built from parts so this file does not match itself.
    const shape = new RegExp(["__html", ":\\s*JSON\\.stringify\\("].join(""));
    const offenders = walk(root, [])
      .filter((f) => shape.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
