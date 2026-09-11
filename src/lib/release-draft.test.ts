import { describe, expect, it } from "vitest";
import {
  draftFromRelease,
  draftFromReleases,
  firstSentence,
  headline,
} from "@/lib/release-draft";
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

describe("firstSentence", () => {
  it("stops at the end of the first sentence", () => {
    expect(firstSentence("One thing. Then another.")).toBe("One thing.");
  });

  it("does not cut on a decimal point", () => {
    // The changelog is full of money; "₦2,000.00 to your wallet" must survive.
    expect(firstSentence("We add ₦2,000.00 to your wallet. Nice.")).toBe(
      "We add ₦2,000.00 to your wallet.",
    );
  });

  it("does not cut on an abbreviation mid-sentence", () => {
    expect(firstSentence("Use it e.g. for baptism classes. Then stop.")).toBe(
      "Use it e.g. for baptism classes.",
    );
  });

  it("returns the whole text when there is only one sentence", () => {
    expect(firstSentence("Just the one sentence.")).toBe(
      "Just the one sentence.",
    );
  });

  it("treats a quoted next sentence as a new sentence", () => {
    expect(firstSentence('It works. "Giving" now agrees.')).toBe("It works.");
  });
});

describe("headline", () => {
  it("drops the trailing full stop, because bullets read better without it", () => {
    expect(headline("Report PDFs are far easier to read.")).toBe(
      "Report PDFs are far easier to read",
    );
  });

  it("keeps the half before an em dash when the line runs long", () => {
    const long =
      "Your link is already on every PDF you produce — the small line at the foot of a report now links to it.";
    expect(headline(long)).toBe("Your link is already on every PDF you produce");
  });

  it("cuts on a word boundary and marks the cut", () => {
    const out = headline("word ".repeat(60), 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("wor…");
  });

  it("leaves a short line completely alone", () => {
    expect(headline("Finance: keep the books")).toBe("Finance: keep the books");
  });
});

describe("draftFromRelease", () => {
  it("uses one friendly title rather than a version number", () => {
    // "0.62.0" means nothing to a pastor.
    const { title } = draftFromRelease(sample);
    expect(title).toBe("What's new in FlockInsight ✨");
    expect(title).not.toContain("1.2.3");
  });

  it("leads with the summary, which is the part a pastor reads", () => {
    expect(draftFromRelease(sample).body.startsWith("A short line")).toBe(true);
  });

  it("lists the wins as bullets", () => {
    const { body } = draftFromRelease(sample);
    expect(body).toContain("• A new thing");
    expect(body).toContain("• Another new thing");
  });

  it("counts the fixes instead of describing them", () => {
    // Telling a church how giving was miscounted for three weeks does not
    // reassure anyone.
    const { body } = draftFromRelease(sample);
    expect(body).toContain("1 small fix");
    expect(body).not.toContain("Something that was broken");
  });

  it("never prints the developer category headings", () => {
    const { body } = draftFromRelease(sample);
    for (const h of ["Added:", "Fixed:", "Improved:", "Security:", "Changed:"]) {
      expect(body).not.toContain(h);
    }
  });

  it("caps the bullets and says how many were left out", () => {
    const wordy: Release = {
      version: "9.9.9",
      date: "2026-01-01",
      changes: { Added: Array.from({ length: 9 }, (_, i) => `Thing ${i}`) },
    };
    const { body } = draftFromRelease(wordy);
    expect(body.split("•").length - 1).toBe(4);
    expect(body).toContain("5 more updates");
  });

  it("says 'fix' not 'fixes' for exactly one", () => {
    expect(draftFromRelease(sample).body).toContain("1 small fix.");
  });

  it("ends by telling them what to do", () => {
    expect(draftFromRelease(sample).body).toContain("open FlockInsight");
  });

  it("copes with a release that has no summary", () => {
    const { body } = draftFromRelease({ ...sample, summary: undefined });
    expect(body.startsWith("• A new thing")).toBe(true);
  });

  it("copes with a release that lists no changes at all", () => {
    const { body } = draftFromReleases([
      { version: "0.0.1", date: "2026-01-01", summary: "Just a summary.", changes: {} },
    ]);
    expect(body).toContain("Just a summary");
  });

  it("stays well inside the composer's limit on our real releases", () => {
    for (const r of releases.slice(0, 8)) {
      const { body } = draftFromRelease(r);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThanOrEqual(2000);
      // The whole point is brevity — the old version ran to ~1700 characters.
      expect(body.length).toBeLessThan(900);
    }
  });
});

describe("draftFromReleases", () => {
  const five = releases.slice(0, 5);

  it("gives one line per release", () => {
    const { body } = draftFromReleases(five);
    expect(body.split("•").length - 1).toBe(5);
  });

  it("keeps only the first idea when a summary carries two", () => {
    const { body } = draftFromReleases([
      {
        version: "1.0.0",
        date: "2026-01-01",
        summary: "Refer a church and earn credit — plus readable reports.",
        changes: {},
      },
      {
        version: "0.9.0",
        date: "2025-12-01",
        summary: "Something else entirely.",
        changes: {},
      },
    ]);
    expect(body).toContain("• Refer a church and earn credit");
    expect(body).not.toContain("plus readable reports");
  });

  it("falls back to the first win when a release has no summary", () => {
    const { body } = draftFromReleases([
      { version: "1.0.0", date: "2026-01-01", changes: { Added: ["A shiny thing"] } },
      { version: "0.9.0", date: "2025-12-01", summary: "Older news.", changes: {} },
    ]);
    expect(body).toContain("• A shiny thing");
  });

  it("totals the quiet work across every release", () => {
    const { body } = draftFromReleases([
      { version: "1.0.0", date: "2026-01-01", summary: "One.", changes: { Fixed: ["a", "b"] } },
      { version: "0.9.0", date: "2025-12-01", summary: "Two.", changes: { Security: ["c"] } },
    ]);
    expect(body).toContain("3 small fixes");
  });

  it("degrades to a single-release draft when given one", () => {
    expect(draftFromReleases([sample])).toEqual(draftFromRelease(sample));
  });

  it("returns an empty body rather than a broken notice when given nothing", () => {
    expect(draftFromReleases([]).body).toBe("");
  });

  it("stays short enough to read on a phone", () => {
    const { body } = draftFromReleases(five);
    expect(body.length).toBeLessThan(1000);
    expect(body).toContain("open FlockInsight");
  });
});
