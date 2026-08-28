import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  DATASETS,
  allowedDatasets,
  canDownload,
  getDataset,
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
