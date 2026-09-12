import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  MIN_VISITS,
  SNOOZE_DAYS,
  installRoute,
  nextAskAt,
  parseState,
  recordDismissal,
  recordInstalled,
  recordVisit,
  shouldAskToInstall,
  type InstallState,
} from "@/lib/pwa-install";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);

function state(over: Partial<InstallState> = {}): InstallState {
  return { ...EMPTY_STATE, visits: MIN_VISITS, ...over };
}

describe("shouldAskToInstall", () => {
  it("says nothing on a first visit", () => {
    // Asking someone to install before they have looked around reads as an ad
    // for software they are already using.
    expect(shouldAskToInstall(state({ visits: 1 }), NOW)).toBe(false);
  });

  it("asks once they have come back", () => {
    expect(shouldAskToInstall(state({ visits: MIN_VISITS }), NOW)).toBe(true);
  });

  it("never asks again once installed", () => {
    expect(
      shouldAskToInstall(state({ installed: true, visits: 99 }), NOW),
    ).toBe(false);
  });

  it("goes quiet for a week after the first no", () => {
    const s = recordDismissal(state(), NOW);
    expect(shouldAskToInstall(s, NOW + 6 * DAY)).toBe(false);
    expect(shouldAskToInstall(s, NOW + 7 * DAY)).toBe(true);
  });

  it("waits longer after the second no", () => {
    let s = recordDismissal(state(), NOW);
    s = recordDismissal(s, NOW + 7 * DAY);
    expect(shouldAskToInstall(s, NOW + 7 * DAY + 29 * DAY)).toBe(false);
    expect(shouldAskToInstall(s, NOW + 7 * DAY + 30 * DAY)).toBe(true);
  });

  it("treats a third no as close enough to an answer", () => {
    let s = state();
    for (let i = 0; i < 3; i++) s = recordDismissal(s, NOW);
    expect(shouldAskToInstall(s, NOW + 89 * DAY)).toBe(false);
    expect(shouldAskToInstall(s, NOW + 90 * DAY)).toBe(true);
  });

  it("does not keep growing the gap past the last step", () => {
    // A fifth refusal should not push the next ask out to a year.
    let s = state();
    for (let i = 0; i < 6; i++) s = recordDismissal(s, NOW);
    expect(nextAskAt(s)).toBe(NOW + SNOOZE_DAYS[SNOOZE_DAYS.length - 1] * DAY);
  });

  it("asks immediately when nothing has been dismissed yet", () => {
    expect(nextAskAt(state())).toBe(0);
  });
});

describe("parseState", () => {
  it("starts fresh when there is nothing stored", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
  });

  it("reads a state it wrote", () => {
    const s = recordDismissal(recordVisit(EMPTY_STATE), NOW);
    expect(parseState(JSON.stringify(s))).toEqual(s);
  });

  it("starts fresh rather than crashing on corrupt storage", () => {
    // localStorage is user-editable and survives across deploys.
    expect(parseState("not json")).toEqual(EMPTY_STATE);
    expect(parseState("{")).toEqual(EMPTY_STATE);
  });

  it("refuses nonsense values instead of trusting them", () => {
    const out = parseState(
      JSON.stringify({
        dismissals: -5,
        lastDismissedAt: "soon",
        visits: 1.7,
        installed: "yes",
      }),
    );
    expect(out.dismissals).toBe(0);
    expect(out.lastDismissedAt).toBe(0);
    expect(out.visits).toBe(1);
    // Only a real boolean counts, or anyone could switch the prompt off for
    // everyone by typing a string.
    expect(out.installed).toBe(false);
  });

  it("does not let a negative dismissal count bring the prompt back early", () => {
    const s = parseState(JSON.stringify({ dismissals: -99, visits: 5 }));
    expect(nextAskAt(s)).toBe(0);
    expect(shouldAskToInstall(s, NOW)).toBe(true);
  });
});

describe("recording", () => {
  it("counts visits without touching anything else", () => {
    expect(recordVisit(EMPTY_STATE).visits).toBe(1);
    expect(recordVisit(recordVisit(EMPTY_STATE)).visits).toBe(2);
  });

  it("installing ends it for good", () => {
    const s = recordInstalled(recordDismissal(state(), NOW));
    expect(shouldAskToInstall(s, NOW + 365 * DAY)).toBe(false);
  });
});

describe("installRoute", () => {
  it("uses the browser's own prompt when there is one", () => {
    expect(installRoute({ hasDeferredPrompt: true, isIOS: false })).toBe(
      "prompt",
    );
  });

  it("falls back to instructions on iOS, which has no install API", () => {
    // Safari never fires beforeinstallprompt. An "Install" button that does
    // nothing is worse than no button.
    expect(installRoute({ hasDeferredPrompt: false, isIOS: true })).toBe("ios");
  });

  it("prefers the real prompt if iOS ever gains one", () => {
    expect(installRoute({ hasDeferredPrompt: true, isIOS: true })).toBe(
      "prompt",
    );
  });

  it("says so plainly when there is no route at all", () => {
    expect(installRoute({ hasDeferredPrompt: false, isIOS: false })).toBe(
      "unsupported",
    );
  });
});
