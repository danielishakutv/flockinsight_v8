import { describe, expect, it } from "vitest";
import {
  readability,
  readabilityNote,
  sampleLabel,
  seriesSample,
  shareLabel,
  type Sample,
} from "@/lib/thin-data";

/**
 * The rules that stop a confident-looking chart being drawn from four
 * observations. The cases that matter are the ones where a number looks big
 * and isn't.
 */

const s = (n: number, churches: number, unit = "rows"): Sample => ({ n, churches, unit });

describe("readability", () => {
  it("calls the platform's own church count thin, not solid", () => {
    // Fourteen churches: enough to show, not enough to conclude from.
    expect(readability(s(14, 14, "churches"), "churches")).toBe("thin");
  });

  it("refuses to read pricing from nine payments", () => {
    expect(readability(s(9, 4, "payments"), "money")).toBe("too_thin");
  });

  it("treats a big row count from few churches as too thin", () => {
    // 425 members sounds sturdy; they live inside four churches, and one
    // church changing how it records moves the whole population.
    expect(readability(s(425, 4, "members"), "people")).toBe("too_thin");
  });

  it("lets the same row count through once enough churches contribute", () => {
    expect(readability(s(425, 6, "members"), "people")).toBe("thin");
    expect(readability(s(4000, 40, "members"), "people")).toBe("solid");
  });

  it("judges events by contributing churches, not event volume", () => {
    // 4170 events is a large-sounding number from five churches.
    expect(readability(s(4170, 4, "events"), "events")).toBe("too_thin");
    expect(readability(s(4170, 5, "events"), "events")).toBe("thin");
  });
});

describe("seriesSample", () => {
  it("counts days that carry a value, not days on the axis", () => {
    // 90 days where 84 are flat zero is six observations, not ninety.
    const ninetyDays = [...Array(84).fill(0), 1, 2, 3, 4, 5, 6];
    const sample = seriesSample(ninetyDays, 5);
    expect(sample.n).toBe(6);
    expect(readability(sample, "series")).toBe("thin");
  });

  it("calls a nearly empty series too thin", () => {
    expect(readability(seriesSample([0, 0, 0, 0, 1, 2], 3), "series")).toBe("too_thin");
  });
});

describe("shareLabel", () => {
  it("never renders a percentage over a denominator under ten", () => {
    // "67%" from two of three is the precise failure being defended against.
    expect(shareLabel(2, 3)).toBe("2 of 3");
    expect(shareLabel(3, 9)).toBe("3 of 9");
  });

  it("uses a percentage once the denominator can carry one", () => {
    expect(shareLabel(5, 10)).toBe("50%");
    expect(shareLabel(140, 400)).toBe("35%");
  });

  it("does not divide by zero", () => {
    expect(shareLabel(0, 0)).toBe("—");
  });
});

describe("sampleLabel", () => {
  it("names both numbers, so neither can stand alone", () => {
    expect(sampleLabel(s(425, 5, "members"))).toBe("425 members · from 5 churches");
  });

  it("says church, singular, when there is one", () => {
    expect(sampleLabel(s(12, 1, "payments"))).toBe("12 payments · from 1 church");
  });

  it("drops the clause when the church count means nothing", () => {
    expect(sampleLabel(s(14, 0, "churches"))).toBe("14 churches");
  });
});

describe("readabilityNote", () => {
  it("says nothing when there is nothing to warn about", () => {
    expect(readabilityNote("solid", "money")).toBe("");
  });

  it("gives every kind its own sentence at every level", () => {
    const kinds = ["churches", "money", "people", "events", "series"] as const;
    for (const k of kinds) {
      expect(readabilityNote("thin", k).length).toBeGreaterThan(10);
      expect(readabilityNote("too_thin", k).length).toBeGreaterThan(10);
    }
  });
});
