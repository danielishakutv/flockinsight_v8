import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  DATASETS,
  allowedDatasets,
  canDownload,
  catalogPhrasesComplete,
  dateFilterPhrase,
  getDataset,
  linkedDatasets,
} from "@/lib/report-catalog";
import { parseRange, rangeLabel, rangeQuery, rangeSuffix } from "@/lib/report-range";

describe("the dataset catalogue", () => {
  it("has no duplicate ids", () => {
    const ids = DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that are safe as filenames and URL segments", () => {
    for (const d of DATASETS) expect(d.id).toMatch(/^[a-z0-9-]+$/);
  });

  it("puts every dataset in a real category", () => {
    const keys = new Set(CATEGORIES.map((c) => c.key));
    for (const d of DATASETS) expect(keys.has(d.category)).toBe(true);
  });

  // A join is only useful if it points at something that exists — a typo here
  // would send an analyst looking for a file that was never in the bundle.
  it("only declares joins to datasets that exist", () => {
    const ids = new Set(DATASETS.map((d) => d.id));
    for (const d of DATASETS) {
      for (const j of d.joins ?? []) {
        const [target] = j.target.split(".");
        expect(
          ids.has(target),
          `${d.id} joins to unknown dataset "${target}"`,
        ).toBe(true);
      }
    }
  });
});

describe("saying it in English", () => {
  /*
   * The reports page used to show a dataset's wiring verbatim: "Filtered by
   * created at" and "Joins to household_id -> households.household_id". These
   * tests hold the replacement, because the failure they guard against is
   * silent — a new dataset with an unmapped date column would simply start
   * printing a column name at a church administrator, and nothing would break.
   */
  it("has a readable phrase for every date column in use", () => {
    const { unphrasedDateColumns } = catalogPhrasesComplete();
    expect(
      unphrasedDateColumns,
      `Add these to DATE_FILTER_PHRASE in report-catalog.ts: ${unphrasedDateColumns.join(", ")}`,
    ).toEqual([]);
  });

  it("points every join at a dataset that can be named", () => {
    const { unknownJoinTargets } = catalogPhrasesComplete();
    expect(unknownJoinTargets).toEqual([]);
  });

  it("writes a sentence, not a column name", () => {
    for (const d of DATASETS) {
      const phrase = dateFilterPhrase(d);
      if (!d.dateColumn) {
        expect(phrase).toBeNull();
        continue;
      }
      expect(phrase).toMatch(/^A date range applies to .+\.$/);
      // A column with an underscore in it is unambiguously machine-shaped, so
      // it must never reach a reader as written. (`date` is checked by the
      // fallback comparison below instead — it is also an English word.)
      if (d.dateColumn.includes("_")) expect(phrase).not.toContain(d.dateColumn);

      /*
       * And the sentence must not BE the column with its underscores taken
       * out, which is what the page used to print and what `dateFilterPhrase`
       * still falls back to for an unmapped column. Written as "is not the
       * fallback" rather than "does not contain the words": "when it was
       * scheduled for" is good English that happens to contain "scheduled
       * for", and a test that cannot tell those apart is a test that
       * punishes the right answer.
       */
      const fallback = `A date range applies to ${d.dateColumn.replace(/_/g, " ")}.`;
      expect(phrase).not.toBe(fallback);
    }
  });

  it("names the other file rather than the key, and keeps the key", () => {
    const members = getDataset("members")!;
    const links = linkedDatasets(members);

    expect(links.map((l) => l.label)).toEqual(["Households", "Members", "Team"]);

    // A member's guardian is another member, so that link points home. The
    // page says "other rows in this same file" rather than naming the file
    // the reader is already looking at.
    const self = links.find((l) => l.self);
    expect(self?.id).toBe("members");

    // The exact columns are not thrown away — they move to the hover.
    expect(links.flatMap((l) => l.keys).sort()).toEqual([
      "assigned_to_id",
      "guardian_id",
      "household_id",
      "invited_by_id",
    ]);

    /*
     * Two of those point at the same file: a member's guardian and the member
     * who invited them are both members. They are grouped into ONE mention
     * carrying both keys, which is the whole reason linkedDatasets exists —
     * "Can be matched up with Members, Members and Households" would be worse
     * than the foreign keys it replaced.
     */
    expect(self?.keys.sort()).toEqual(["guardian_id", "invited_by_id"]);
  });

  it("groups several keys pointing at the same file into one mention", () => {
    for (const d of DATASETS) {
      const links = linkedDatasets(d);
      expect(new Set(links.map((l) => l.id)).size).toBe(links.length);
      expect(links.reduce((a, l) => a + l.keys.length, 0)).toBe(
        (d.joins ?? []).length,
      );
    }
  });
});

describe("every catalogued dataset can actually be built", () => {
  // The catalogue and the builders are two lists that must stay in step. A
  // dataset offered on the page with no builder behind it is a 500 at the
  // moment someone clicks download, which is the worst place to find out.
  it("has a builder for every dataset, and no builder without one", async () => {
    const { BUILDABLE_IDS } = await import("@/lib/report-data");
    const catalogued = DATASETS.map((d) => d.id).sort();
    expect([...BUILDABLE_IDS].sort()).toEqual(catalogued);
  });
});

describe("permission gating", () => {
  const members = getDataset("members")!;

  it("lets the owner download anything", () => {
    expect(canDownload(members, [], true)).toBe(true);
  });

  it("refuses someone without the dataset's permission", () => {
    expect(canDownload(members, ["giving.view"], false)).toBe(false);
  });

  it("allows someone holding exactly the right permission", () => {
    expect(canDownload(members, ["members.view"], false)).toBe(true);
  });

  it("narrows the list to what a role can actually see", () => {
    const allowed = allowedDatasets(["giving.view"], false);
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every((d) => d.perm === "giving.view")).toBe(true);
    expect(allowedDatasets([], false)).toHaveLength(0);
  });
});

describe("date ranges", () => {
  const parse = (q: string) => parseRange(new URLSearchParams(q));

  it("accepts a well-formed range", () => {
    expect(parse("from=2026-01-01&to=2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("ignores junk rather than passing it to the database", () => {
    expect(parse("from=yesterday&to=2026-13-45")).toEqual({ from: null, to: null });
  });

  // A backwards range returns nothing at all, which reads as "no data" rather
  // than "you typed the dates the wrong way round".
  it("swaps a backwards range instead of returning nothing", () => {
    expect(parse("from=2026-06-01&to=2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-06-01",
    });
  });

  it("labels every shape of range", () => {
    expect(rangeLabel({ from: null, to: null })).toBe("All time");
    expect(rangeLabel({ from: "2026-01-01", to: null })).toBe("From 2026-01-01");
    expect(rangeLabel({ from: null, to: "2026-01-01" })).toBe("Up to 2026-01-01");
    expect(rangeLabel({ from: "2026-01-01", to: "2026-02-01" })).toBe(
      "2026-01-01 to 2026-02-01",
    );
  });

  it("builds filename suffixes and query strings", () => {
    expect(rangeSuffix({ from: null, to: null })).toBe("");
    expect(rangeSuffix({ from: "2026-01-01", to: "2026-03-31" })).toBe(
      "-2026-01-01_2026-03-31",
    );
    expect(rangeQuery({ from: null, to: null })).toBe("");
    expect(rangeQuery({ from: "2026-01-01", to: null })).toBe("&from=2026-01-01");
  });
});

describe("headline figures and the date range", () => {
  it("classifies every numeric total as activity or population", async () => {
    /*
     * The bug this guards against: the summary PDF printed a date range in
     * its header over figures that had never been filtered, so a church
     * asking for January to March got all-time numbers under those dates.
     *
     * Adding a figure to ChurchTotals now fails here until somebody says
     * whether it follows the range — which is the decision that was missed.
     */
    const { ACTIVITY_TOTALS, POPULATION_TOTALS } = await import("@/lib/report-data");

    // The numeric fields of ChurchTotals, kept in step with the type.
    const numericFields = [
      "members",
      "households",
      "groups",
      "sessions",
      "avgAttendance",
      "givingTotal",
      "givingEntries",
      "messages",
    ];

    const classified = [...ACTIVITY_TOTALS, ...POPULATION_TOTALS];
    expect([...classified].sort()).toEqual([...numericFields].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("treats money and attendance as activity, not population", async () => {
    const { ACTIVITY_TOTALS } = await import("@/lib/report-data");
    for (const k of ["givingTotal", "sessions", "avgAttendance", "messages"]) {
      expect(ACTIVITY_TOTALS).toContain(k);
    }
  });
});
