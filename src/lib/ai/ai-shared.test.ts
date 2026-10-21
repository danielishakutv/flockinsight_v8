import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { AI_REASONS, REASON_KEY, SUMMARY_UI_REASONS, canReadChurchSummary } from "./ai-shared";

describe("canReadChurchSummary", () => {
  it("lets an owner read with no permissions at all", () => {
    expect(canReadChurchSummary({ isOwner: true, perms: new Set() })).toBe(true);
  });

  it("refuses analytics.view alone: the summary covers giving and follow-up too", () => {
    expect(canReadChurchSummary({ isOwner: false, perms: new Set(["analytics.view"]) })).toBe(false);
    expect(
      canReadChurchSummary({ isOwner: false, perms: new Set(["analytics.view", "giving.view"]) }),
    ).toBe(false);
  });

  it("allows all three together", () => {
    expect(
      canReadChurchSummary({
        isOwner: false,
        perms: new Set(["analytics.view", "giving.view", "followup.view"]),
      }),
    ).toBe(true);
  });
});

describe("REASON_KEY", () => {
  it("covers every runAi reason and every UI-only reason, each with a real ai.* key", () => {
    const keys = Object.keys(REASON_KEY).sort();
    expect(keys).toEqual([...AI_REASONS, ...SUMMARY_UI_REASONS].sort());
    const ai = en.ai as Record<string, unknown>;
    for (const k of Object.values(REASON_KEY)) {
      expect(k.startsWith("ai.")).toBe(true);
      expect(typeof ai[k.slice(3)], k).toBe("string");
    }
  });
});
