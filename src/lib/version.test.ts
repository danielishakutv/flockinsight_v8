import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "@/lib/version";
import { releases } from "@/lib/changelog";

/**
 * The version is load-bearing in ways that are not obvious from looking at it.
 *
 * It was a hand-typed constant with a comment asking whoever edited it to keep
 * it in sync with package.json. It drifted, sat at 0.65.0 through four
 * releases, and nothing broke loudly — a stale version string is still a valid
 * version string. What it did instead was switch off the what's-new banner for
 * everybody who had already seen 0.65, make `ensureReleaseDraft` report
 * "already-drafted" on every cron tick for ever, and tell every church in the
 * Settings card that it was running a version from four releases ago.
 *
 * It is now derived from package.json, so that half cannot drift again. These
 * tests hold the half that still can: writing the release notes.
 */

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * package.json read from disk, not imported.
 *
 * An import here would pass whatever the bundler resolves; reading the file is
 * the same check the injection in next.config.ts performs, done independently.
 */
const packageVersion: string = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"),
).version;

/** "0.68.1" -> [0, 68, 1], for ordering. Pre-release suffixes are ignored. */
function parts(v: string): number[] {
  return v.split("-")[0].split(".").map(Number);
}

function compare(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

describe("the running version", () => {
  it("is whatever package.json says, not a second copy of it", () => {
    expect(APP_VERSION).toBe(packageVersion);
  });

  it("is injected rather than typed into a source file", () => {
    // The literal must not appear in version.ts. If it does, somebody has put
    // it back by hand and the drift this file exists to prevent is possible
    // again the moment package.json moves.
    const source = readFileSync(
      join(import.meta.dirname, "version.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toContain(packageVersion);
  });

  it("looks like a version", () => {
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it("has release notes written for it", () => {
    const release = releases.find((r) => r.version === APP_VERSION);
    expect(
      release,
      `package.json is at ${APP_VERSION} but src/lib/changelog.ts has no entry for it. ` +
        `Without one the what's-new banner has nothing to say and ensureReleaseDraft ` +
        `returns "no-changelog" on every tick — both silently. Add the entry at the top.`,
    ).toBeDefined();
  });

  it("has a summary, which is what the what's-new banner shows", () => {
    const release = releases.find((r) => r.version === APP_VERSION);
    // The banner reads `release.summary`. Without one it still appears, with
    // only the heading and the link — which is a worse banner, not a broken
    // one, so this is asserted here rather than guarded in the component.
    expect(release?.summary?.trim()).toBeTruthy();
  });
});

describe("the changelog", () => {
  it("is newest first, which is what every reader of it assumes", () => {
    for (let i = 1; i < releases.length; i++) {
      expect(
        compare(releases[i - 1].version, releases[i].version),
        `${releases[i - 1].version} is listed above ${releases[i].version}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("leads with the version that is running", () => {
    expect(releases[0]?.version).toBe(APP_VERSION);
  });

  it("names each version once", () => {
    const seen = releases.map((r) => r.version);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives every release a well-formed version and date", () => {
    for (const r of releases) {
      expect(r.version, `${r.version} is not a version`).toMatch(SEMVER);
      expect(r.date, `${r.version} has a malformed date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
    }
  });

  it("says something under at least one heading in every release", () => {
    for (const r of releases) {
      const lines = Object.values(r.changes).flat();
      expect(lines.length, `${r.version} lists no changes`).toBeGreaterThan(0);
    }
  });
});
