import { describe, expect, it } from "vitest";
import {
  BOARD_ORDER,
  PRIORITY_RANK,
  ROADMAP_PRIORITIES,
  ROADMAP_STATUSES,
  isRoadmapStatus,
  priorityMeta,
  readStatus,
  statusMeta,
} from "@/lib/roadmap-shared";

/**
 * The roadmap had five statuses and a kanban board. It has two and a list.
 *
 * The interesting part of that change is not the two that remain, it is the
 * three that went. "idea", "planned", "in_progress" and "parked" are still out
 * there — in the API examples in AGENTS.md, in anything anybody scripted
 * against the old feed, and in `legacy_status` on every row. Refusing them
 * would be correct and useless: every one of them meant "not shipped yet".
 */

describe("the two statuses", () => {
  it("is two, and they are todo and shipped", () => {
    expect(ROADMAP_STATUSES.map((s) => s.value)).toEqual(["todo", "shipped"]);
    expect(BOARD_ORDER).toEqual(["todo", "shipped"]);
  });

  it("recognises its own values and nothing else", () => {
    expect(isRoadmapStatus("todo")).toBe(true);
    expect(isRoadmapStatus("shipped")).toBe(true);
    expect(isRoadmapStatus("planned")).toBe(false);
    expect(isRoadmapStatus("")).toBe(false);
    expect(isRoadmapStatus(null)).toBe(false);
  });
});

describe("reading a status that arrived from somewhere else", () => {
  it("passes the current two straight through", () => {
    expect(readStatus("todo")).toBe("todo");
    expect(readStatus("shipped")).toBe("shipped");
  });

  it("reads all four retired names as todo, because that is what they meant", () => {
    for (const old of ["idea", "planned", "in_progress", "parked"]) {
      expect(readStatus(old), `${old} should read as todo`).toBe("todo");
    }
  });

  it("refuses something that was never a status, rather than guessing", () => {
    // The difference matters: "planned" is a synonym, "plnned" is a typo, and
    // silently turning a typo into `todo` is how a caller never finds out that
    // its request did something other than what it asked.
    expect(readStatus("plnned")).toBeNull();
    expect(readStatus("done")).toBeNull();
    expect(readStatus("")).toBeNull();
    expect(readStatus(undefined)).toBeNull();
    expect(readStatus(7)).toBeNull();
  });
});

describe("priorities", () => {
  it("ranks every priority, most important first", () => {
    const ranked = ROADMAP_PRIORITIES.map((p) => p.value).sort(
      (a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b],
    );
    expect(ranked).toEqual(["critical", "high", "medium", "low"]);
  });

  it("gives every priority a rank, so none can sort arbitrarily", () => {
    for (const p of ROADMAP_PRIORITIES) {
      expect(typeof PRIORITY_RANK[p.value]).toBe("number");
    }
  });
});

describe("the lookups the pages use", () => {
  it("falls back to a real entry rather than undefined", () => {
    // Both are called with values straight out of the database, including the
    // legacy ones, and a page that renders `undefined.label` is a crash.
    expect(statusMeta("planned").value).toBe("todo");
    expect(statusMeta("nonsense").value).toBe("todo");
    expect(priorityMeta("nonsense").value).toBe("medium");
  });

  it("finds the statuses and priorities that do exist", () => {
    expect(statusMeta("shipped").label).toBe("Shipped");
    expect(priorityMeta("critical").label).toBe("Critical");
  });
});
