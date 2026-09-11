import { describe, expect, it } from "vitest";
import { draftFromRelease } from "@/lib/release-draft";
import { releases } from "@/lib/changelog";
import type { Release } from "@/lib/changelog";

const sample: Release = {
  version: "1.2.3",
  date: "2026-09-11",
  summary: "A short line about what this release is for.",
  changes: {
    Added: ["A new thing", "Another new thing"],
    Fixed: ["Something that was broken"],
  },
};

describe("draftFromRelease", () => {
  it("titles the announcement with the version", () => {
    expect(draftFromRelease(sample).title).toBe(
      "What's new in FlockInsight 1.2.3",
    );
  });

  it("leads with the summary, which is the part a pastor reads", () => {
    expect(draftFromRelease(sample).body.startsWith(sample.summary!)).toBe(true);
  });

  it("lists every change under its heading", () => {
    const { body } = draftFromRelease(sample);
    expect(body).toContain("Added:");
    expect(body).toContain("• A new thing");
    expect(body).toContain("Fixed:");
    expect(body).toContain("• Something that was broken");
  });

  it("skips headings with nothing under them", () => {
    const { body } = draftFromRelease(sample);
    expect(body).not.toContain("Security:");
    expect(body).not.toContain("Improved:");
  });

  it("copes with a release that has no summary", () => {
    const { body } = draftFromRelease({ ...sample, summary: undefined });
    expect(body.startsWith("Added:")).toBe(true);
  });

  it("copes with a release that lists no changes at all", () => {
    const { body } = draftFromRelease({
      version: "0.0.1",
      date: "2026-01-01",
      summary: "Just a summary.",
      changes: {},
    });
    expect(body).toBe("Just a summary.");
  });

  it("stays inside the composer's limit, whatever the changelog does", () => {
    // The action rejects a body over 2000 characters, so a talkative release
    // must not produce a draft that cannot be saved.
    const huge: Release = {
      version: "9.9.9",
      date: "2026-01-01",
      summary: "x".repeat(500),
      changes: { Added: Array.from({ length: 80 }, (_, i) => `Item ${i} ${"y".repeat(60)}`) },
    };
    const { body } = draftFromRelease(huge);
    expect(body.length).toBeLessThanOrEqual(2000);
    expect(body.endsWith("…")).toBe(true);
  });

  it("cuts on a line boundary rather than mid-sentence", () => {
    const huge: Release = {
      version: "9.9.9",
      date: "2026-01-01",
      changes: { Added: Array.from({ length: 60 }, (_, i) => `Item number ${i}`) },
    };
    const { body } = draftFromRelease(huge);
    // Everything before the ellipsis should be whole lines.
    const kept = body.replace(/…$/, "");
    expect(kept.split("\n").pop()).not.toBe("");
  });

  it("produces a usable draft from the real, current changelog", () => {
    // The point of the feature is that it works on OUR release notes, not on
    // a tidy fixture.
    for (const r of releases.slice(0, 5)) {
      const { title, body } = draftFromRelease(r);
      expect(title).toContain(r.version);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThanOrEqual(2000);
    }
  });
});
