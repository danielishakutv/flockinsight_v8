import { describe, expect, it } from "vitest";
import {
  MIN_ACTIVITY,
  SNOOZE_DAYS,
  dismiss,
  emptyState,
  markAnswered,
  recordActivity,
  shouldAsk,
} from "@/lib/translation-prompt";

/**
 * When somebody gets asked about the translation. The cases that matter are
 * all about NOT asking: too early, too often, or about a language we did not
 * machine-translate.
 */

const busy = (locale: string) => ({
  ...emptyState(locale),
  activity: MIN_ACTIVITY,
});

describe("shouldAsk", () => {
  it("waits until they have actually used the app in that language", () => {
    // Asking on the switch gets an opinion from somebody who has seen one
    // screen.
    expect(shouldAsk({ ...emptyState("fr"), activity: 1 }, "fr")).toBe(false);
    expect(shouldAsk(busy("fr"), "fr")).toBe(true);
  });

  it("never asks about English", () => {
    expect(shouldAsk(busy("en"), "en")).toBe(false);
  });

  it("asks about every language we generated rather than reviewed", () => {
    for (const l of ["fr", "pt", "sw", "ha", "ig", "yo", "pcm"]) {
      expect(shouldAsk(busy(l), l)).toBe(true);
    }
  });

  it("does not ask again once they have sent something", () => {
    expect(shouldAsk(markAnswered(busy("pt")), "pt")).toBe(false);
  });

  it("respects a dismissal for a month, then asks once more", () => {
    const state = dismiss(busy("sw"), 0);
    const nearly = SNOOZE_DAYS * 86_400_000 - 1000;
    // Dismissing also resets the counter, so they have to use it again too.
    expect(shouldAsk(state, "sw", nearly)).toBe(false);

    const later = { ...state, activity: MIN_ACTIVITY };
    expect(shouldAsk(later, "sw", nearly)).toBe(false);
    expect(shouldAsk(later, "sw", SNOOZE_DAYS * 86_400_000 + 1000)).toBe(true);
  });

  it("ignores a count that belongs to a different language", () => {
    // Someone who used it in French for a month and switched to Swahili has
    // seen nothing in Swahili.
    expect(shouldAsk(busy("fr"), "sw")).toBe(false);
  });
});

describe("recordActivity", () => {
  it("counts up within one language", () => {
    let s = recordActivity(null, "fr");
    expect(s.activity).toBe(1);
    s = recordActivity(s, "fr");
    expect(s.activity).toBe(2);
  });

  it("starts again when the language changes", () => {
    const s = recordActivity({ ...emptyState("fr"), activity: 20 }, "sw");
    expect(s.locale).toBe("sw");
    expect(s.activity).toBe(1);
  });

  it("does not resurrect an answered state for the same language", () => {
    const answered = markAnswered({ ...emptyState("pt"), activity: 9 });
    expect(shouldAsk(recordActivity(answered, "pt"), "pt")).toBe(false);
  });
});
