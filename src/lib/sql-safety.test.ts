import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A guard against a drizzle trap that fails silently.
 *
 * Inside a raw `sql` template used in a SELECT-field position, drizzle renders
 * `${table.column}` WITHOUT its table qualifier. So a correlated subquery like
 *
 *     sql`(select sum(${giving.amount}) from ${giving}
 *          where ${giving.projectId} = ${project.id})`
 *
 * becomes `where "project_id" = "id"` — and Postgres resolves BOTH names
 * against the inner table. The condition is never true, the subquery returns
 * nothing, and the column comes back as 0. No error, no warning: the page just
 * shows zero forever.
 *
 * That shipped once, in lib/projects.ts, where every project reported zero
 * raised and zero pledged. Two more instances threw "column reference is
 * ambiguous" instead, which is how it was found at all.
 *
 * The fix is always the same: run a grouped aggregate and join it in JS, which
 * has no outer reference to lose. This test fails the build if a new
 * correlated-looking template appears without a deliberate `sql-qualified-ok`
 * annotation saying why it is safe.
 */

const ROOT = join(import.meta.dirname, "..");
const ALLOW_MARKER = "sql-qualified-ok";
const BT = String.fromCharCode(96);
const SQL_TEMPLATE = new RegExp(
  "sql(?:<[^>]*>)?" + BT + "([^" + BT + "]*)" + BT,
  "g",
);
const INTERPOLATED_COLUMN = /\$\{(\w+)\.(\w+)\}/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "migrations") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

type Finding = { file: string; line: number; snippet: string; columns: string[] };

function findSuspects(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(file, "utf8");
    SQL_TEMPLATE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SQL_TEMPLATE.exec(src))) {
      const body = match[1];
      // Only nested queries can misbind — a flat expression has one scope.
      const nested = /\bselect\b/i.test(body) && /\bfrom\b/i.test(body);
      if (!nested) continue;

      const columns = [...body.matchAll(INTERPOLATED_COLUMN)].map(
        (m) => `${m[1]}.${m[2]}`,
      );
      if (columns.length === 0) continue; // pure raw SQL, explicit aliases

      // An explicit annotation on the template, or anywhere in the comment
      // block above it, records that a human checked this one. Counted in
      // LINES, not bytes: the explanation that earns an exemption is usually
      // long enough to fall outside any fixed character window.
      const linesBefore = src
        .slice(0, match.index)
        .split("\n")
        .slice(-12)
        .join("\n");
      if (body.includes(ALLOW_MARKER) || linesBefore.includes(ALLOW_MARKER)) continue;

      findings.push({
        file: file.slice(ROOT.length + 1).replace(/\\/g, "/"),
        line: src.slice(0, match.index).split("\n").length,
        snippet: body.replace(/\s+/g, " ").trim().slice(0, 120),
        columns,
      });
    }
  }
  return findings;
}

describe("raw SQL templates", () => {
  it("has no unannotated correlated subqueries interpolating drizzle columns", () => {
    const findings = findSuspects();
    const report = findings
      .map(
        (f) =>
          `\n  ${f.file}:${f.line}\n    ${f.snippet}\n    interpolates: ${f.columns.join(", ")}`,
      )
      .join("");
    expect(
      findings,
      findings.length
        ? `Correlated subquery in a raw sql template. Drizzle drops the table ` +
            `qualifier here, so the outer column silently binds to the inner ` +
            `table and the result is always empty. Use a grouped aggregate ` +
            `joined in JS instead — or add a "${ALLOW_MARKER}" comment ` +
            `explaining why this one is safe.${report}\n`
        : "",
    ).toHaveLength(0);
  });

  // Proves the scanner actually looks at files, rather than passing because it
  // silently found nothing to scan.
  it("scans a meaningful number of source files", () => {
    expect(sourceFiles(ROOT).length).toBeGreaterThan(100);
  });
});
