import { describe, expect, it } from "vitest";
import {
  badgeColor,
  badgeLabelFor,
  highestBadge,
  passed,
  rankScores,
  TRAINING_BADGE_COLORS,
  type EarnedBadge,
} from "@/lib/training-shared";

function badge(over: Partial<EarnedBadge> = {}): EarnedBadge {
  return {
    courseId: "c1",
    name: "Foundation Class",
    label: "FND",
    color: "indigo",
    icon: "check",
    level: 1,
    completedAt: "2026-01-01",
    ...over,
  };
}

describe("badgeLabelFor", () => {
  it("prefers the label the church set", () => {
    expect(badgeLabelFor({ name: "Foundation Class", badgeLabel: "FND" })).toBe(
      "FND",
    );
  });

  it("ignores a label that is only whitespace", () => {
    expect(badgeLabelFor({ name: "Baptism", badgeLabel: "   " })).toBe("Baptism");
  });

  it("uses a single short word as-is", () => {
    expect(badgeLabelFor({ name: "Baptism" })).toBe("Baptism");
  });

  it("truncates a single very long word so a list stays readable", () => {
    expect(badgeLabelFor({ name: "Discipleship" })).toHaveLength(12);
    expect(badgeLabelFor({ name: "Antidisestablishmentarianism" })).toHaveLength(
      14,
    );
  });

  it("initialises a multi-word name, capped at three words", () => {
    expect(badgeLabelFor({ name: "Foundation Class" })).toBe("FC");
    expect(
      badgeLabelFor({ name: "Pre Marital Counselling Course" }),
    ).toBe("PMC");
  });

  it("survives a blank name rather than throwing", () => {
    expect(badgeLabelFor({ name: "   " })).toBe("?");
  });
});

describe("badgeColor", () => {
  it("falls back to indigo for an unknown or missing key", () => {
    expect(badgeColor("nope")).toBe(TRAINING_BADGE_COLORS.indigo);
    expect(badgeColor(null)).toBe(TRAINING_BADGE_COLORS.indigo);
    expect(badgeColor(undefined)).toBe(TRAINING_BADGE_COLORS.indigo);
  });

  it("returns the requested colour when it exists", () => {
    expect(badgeColor("emerald")).toBe(TRAINING_BADGE_COLORS.emerald);
  });
});

describe("highestBadge", () => {
  it("is null when nothing has been earned", () => {
    expect(highestBadge([])).toBeNull();
  });

  it("picks the highest level, not the most recent", () => {
    const best = highestBadge([
      badge({ courseId: "a", level: 1, completedAt: "2026-06-01" }),
      badge({ courseId: "b", level: 5, completedAt: "2026-01-01" }),
      badge({ courseId: "c", level: 3, completedAt: "2026-09-01" }),
    ]);
    expect(best?.courseId).toBe("b");
  });

  it("keeps the first of two at the same level, so the order is stable", () => {
    const best = highestBadge([
      badge({ courseId: "a", level: 2 }),
      badge({ courseId: "b", level: 2 }),
    ]);
    expect(best?.courseId).toBe("a");
  });
});

describe("passed", () => {
  it("treats an unscored course as passed once finished", () => {
    expect(passed(null, null)).toBe(true);
    expect(passed(80, null)).toBe(true);
  });

  it("fails a scored course with no score recorded", () => {
    expect(passed(null, 50)).toBe(false);
  });

  it("counts the pass mark itself as a pass", () => {
    expect(passed(50, 50)).toBe(true);
    expect(passed(49, 50)).toBe(false);
    expect(passed(51, 50)).toBe(true);
  });

  it("handles a zero pass mark rather than treating it as unset", () => {
    expect(passed(0, 0)).toBe(true);
    expect(passed(null, 0)).toBe(false);
  });
});

describe("rankScores", () => {
  it("ranks highest first", () => {
    const out = rankScores([{ score: 70 }, { score: 90 }, { score: 80 }]);
    expect(out.map((r) => r.rank)).toEqual([3, 1, 2]);
  });

  it("gives tied scores the same place, and does not skip the next", () => {
    // Dense ranking: two firsts are followed by a second, not a third.
    const out = rankScores([{ score: 90 }, { score: 90 }, { score: 80 }]);
    expect(out.map((r) => r.rank)).toEqual([1, 1, 2]);
  });

  it("leaves unscored rows unranked instead of ranking them last", () => {
    const out = rankScores([{ score: null }, { score: 90 }, { score: null }]);
    expect(out.map((r) => r.rank)).toEqual([null, 1, null]);
  });

  it("returns an empty list unchanged", () => {
    expect(rankScores([])).toEqual([]);
  });

  it("preserves the other fields on each row", () => {
    const out = rankScores([{ score: 60, name: "Ada" }]);
    expect(out[0]).toEqual({ score: 60, name: "Ada", rank: 1 });
  });
});
