import { describe, expect, it } from "vitest";
import {
  activeBands,
  bandsFor,
  recordingBands,
  labelFor,
  parseBandConfig,
  totalFrom,
} from "@/lib/attendance-bands";

/**
 * Which people a church counts, and what it calls them.
 *
 * The rules that matter here are all about not breaking a church's own
 * history: a renamed band must keep its column, a disabled band must not
 * quietly stay in the total, and Adults must never disappear.
 */

describe("bandsFor", () => {
  it("gives a church that has configured nothing a working default", () => {
    const bands = activeBands(null);
    expect(bands.map((b) => b.key)).toEqual(["children", "teens", "adults"]);
  });

  it("uses the church's own words", () => {
    const bands = bandsFor({ youths: { label: "Young Adults", enabled: true } });
    expect(bands.find((b) => b.key === "youths")?.label).toBe("Young Adults");
  });

  it("keeps the column when the label changes", () => {
    // The whole reason bands are fixed and only labels vary. Renaming must not
    // orphan years of recorded numbers.
    const renamed = bandsFor({ adults: { label: "Men & Women" } });
    expect(renamed.find((b) => b.key === "adults")?.maleColumn).toBe("maleCount");
  });

  it("refuses to switch Adults off", () => {
    // Every attendance sheet ever recorded put its adults in that column. A
    // church that hid it would be reading its own history with the largest
    // number missing.
    const bands = bandsFor({ adults: { enabled: false } });
    expect(bands.find((b) => b.key === "adults")?.enabled).toBe(true);
  });

  it("turns Youths on when asked", () => {
    const keys = activeBands({ youths: { enabled: true } }).map((b) => b.key);
    expect(keys).toContain("youths");
    // And in reading order, youngest first.
    expect(keys.indexOf("youths")).toBeLessThan(keys.indexOf("adults"));
    expect(keys.indexOf("teens")).toBeLessThan(keys.indexOf("youths"));
  });

  it("falls back to the standard name for a blank label", () => {
    expect(labelFor({ teens: { label: "   " } }, "teens")).toBe("Teens");
  });
});

describe("recordingBands", () => {
  it("asks oldest first, so the form reads like an usher's sheet", () => {
    const keys = recordingBands({
      youths: { enabled: true },
      seniors: { enabled: true },
    }).map((b) => b.key);
    expect(keys).toEqual(["seniors", "adults", "youths", "teens", "children"]);
  });

  it("leaves out the bands this church does not count", () => {
    expect(recordingBands(null).map((b) => b.key)).toEqual([
      "adults",
      "teens",
      "children",
    ]);
  });

  it("is exactly the active bands, reversed — nothing gained or lost", () => {
    // The order is derived, not a second hand-maintained list. If a band is
    // ever added to BAND_SEEDS this stays true without anyone remembering.
    const config = { youths: { enabled: true }, seniors: { enabled: true } };
    expect(recordingBands(config)).toEqual([...activeBands(config)].reverse());
  });
});

describe("totalFrom", () => {
  const counts = {
    maleCount: 40,
    femaleCount: 55,
    teenMaleCount: 8,
    teenFemaleCount: 9,
    childMaleCount: 12,
    childFemaleCount: 11,
    youthMaleCount: 20,
    youthFemaleCount: 25,
  };

  it("adds the bands the church counts", () => {
    // Default config: children + teens + adults. No youths.
    expect(totalFrom(counts, null)).toBe(40 + 55 + 8 + 9 + 12 + 11);
  });

  it("includes youths once they are turned on", () => {
    expect(totalFrom(counts, { youths: { enabled: true } })).toBe(
      40 + 55 + 8 + 9 + 12 + 11 + 20 + 25,
    );
  });

  it("drops a band the church has turned off", () => {
    // Otherwise those people stay in the total for ever with nowhere on the
    // page to see them — a figure that cannot be reconciled with anything.
    expect(totalFrom(counts, { children: { enabled: false } })).toBe(40 + 55 + 8 + 9);
  });

  it("treats missing columns as zero, not as a crash", () => {
    // Rows recorded before a band existed simply have no value there.
    expect(totalFrom({ maleCount: 10 }, null)).toBe(10);
  });
});

describe("parseBandConfig", () => {
  it("keeps what it recognises", () => {
    expect(parseBandConfig({ youths: { label: "Youth", enabled: true } })).toEqual({
      youths: { label: "Youth", enabled: true },
    });
  });

  it("drops a band it does not know", () => {
    // Written by a future build, or by hand. One bad key must not take the
    // attendance form down.
    expect(parseBandConfig({ martians: { enabled: true } })).toEqual({});
  });

  it("survives nonsense", () => {
    expect(parseBandConfig(null)).toEqual({});
    expect(parseBandConfig("not an object")).toEqual({});
    expect(parseBandConfig({ teens: "yes" })).toEqual({});
  });

  it("ignores a label that is not a string", () => {
    expect(parseBandConfig({ teens: { label: 42, enabled: true } })).toEqual({
      teens: { label: undefined, enabled: true },
    });
  });
});
