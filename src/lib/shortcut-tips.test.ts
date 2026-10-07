import { describe, expect, it } from "vitest";
import {
  EMPTY_TIP_STATE,
  MAX_TIPS,
  MIN_VISITS,
  TIP_COOLDOWN_MS,
  chooseTip,
  markLearned,
  markShown,
  markVisit,
  parseTipState,
  samePage,
  serialiseTipState,
  turnTipsOff,
  turnTipsOn,
  type TipState,
} from "@/lib/shortcut-tips";
import { SHORTCUTS, shortcutById, type Shortcut } from "@/lib/shortcuts";

/**
 * Almost all of the value of a tip is in when it does NOT appear.
 *
 * A popup that teaches something is a good feature exactly once per thing
 * taught. The same popup appearing on a Sunday morning while somebody is
 * registering forty visitors is the feature everybody turns off, and they are
 * right to. So these tests are mostly about silence.
 */

const ALL = [...SHORTCUTS];

/** A person who has been around long enough to be taught something. */
function settled(patch: Partial<TipState> = {}): TipState {
  return { ...EMPTY_TIP_STATE, visits: MIN_VISITS, ...patch };
}

const ctx = (patch: Partial<Parameters<typeof chooseTip>[0]> = {}) => ({
  pathname: "/dashboard",
  state: settled(),
  now: 1_700_000_000_000,
  available: ALL,
  hasKeyboard: true,
  ...patch,
});

describe("when a tip stays quiet", () => {
  it("never shows on a phone", () => {
    /*
     * Most of this congregation is on a touchscreen. "Press G then M" there is
     * not a tip, it is litter — and it would be the first impression of the
     * feature for the majority of users.
     */
    expect(chooseTip(ctx({ hasKeyboard: false }))).toBeNull();
  });

  it("never shows again once somebody has turned tips off", () => {
    expect(chooseTip(ctx({ state: settled({ off: true }) }))).toBeNull();
  });

  it("stops for good after six", () => {
    const shown = ALL.slice(0, MAX_TIPS).map((s) => s.id);
    expect(chooseTip(ctx({ state: settled({ shown }) }))).toBeNull();
  });

  it("leaves a brand-new user alone", () => {
    for (let visits = 0; visits < MIN_VISITS; visits++) {
      expect(
        chooseTip(ctx({ state: { ...EMPTY_TIP_STATE, visits } })),
        `visit ${visits}`,
      ).toBeNull();
    }
    expect(chooseTip(ctx({ state: settled() }))).not.toBeNull();
  });

  it("waits two days between tips", () => {
    const now = 1_700_000_000_000;
    const justShown = settled({ shown: ["palette"], lastShownAt: now });

    expect(chooseTip(ctx({ state: justShown, now }))).toBeNull();
    expect(
      chooseTip(ctx({ state: justShown, now: now + TIP_COOLDOWN_MS - 1000 })),
    ).toBeNull();
    expect(
      chooseTip(ctx({ state: justShown, now: now + TIP_COOLDOWN_MS + 1000 })),
    ).not.toBeNull();
  });

  it("says nothing when there is nothing left they do not know", () => {
    const state = settled({ learned: ALL.map((s) => s.id) });
    expect(chooseTip(ctx({ state }))).toBeNull();
  });

  it("says nothing when the person can use nothing", () => {
    expect(chooseTip(ctx({ available: [] }))).toBeNull();
  });
});

describe("the tip retires itself", () => {
  it("never teaches a shortcut somebody has already used", () => {
    /*
     * The whole design. A tip is a question — "do you know this one?" — and
     * pressing the key is the answer. Nothing else in the app gets to keep
     * asking a question it has had answered.
     */
    const first = chooseTip(ctx());
    expect(first).not.toBeNull();

    const learned = markLearned(settled(), first!.id);
    const second = chooseTip(ctx({ state: learned }));
    expect(second?.id).not.toBe(first!.id);
  });

  it("works its way through and then falls silent, without repeating one", () => {
    let state = settled();
    const taught: string[] = [];
    let now = 1_700_000_000_000;

    for (let i = 0; i < 20; i++) {
      const tip = chooseTip(ctx({ state, now }));
      if (!tip) break;
      taught.push(tip.id);
      state = markShown(state, tip.id, now);
      now += TIP_COOLDOWN_MS + 1;
    }

    expect(taught).toHaveLength(MAX_TIPS);
    expect(new Set(taught).size).toBe(MAX_TIPS);
    // And then, for ever after, nothing.
    expect(chooseTip(ctx({ state, now: now + TIP_COOLDOWN_MS * 100 }))).toBeNull();
  });

  it("does not spend one of the six on Escape", () => {
    // Everybody already closes a dialog with Escape. Teaching it would waste
    // the only attention this feature gets.
    let state = settled();
    let now = 1_700_000_000_000;
    for (let i = 0; i < MAX_TIPS; i++) {
      const tip = chooseTip(ctx({ state, now }));
      if (!tip) break;
      expect(tip.id).not.toBe("close");
      state = markShown(state, tip.id, now);
      now += TIP_COOLDOWN_MS + 1;
    }
  });
});

describe("which tip, and when", () => {
  it("teaches the palette first — it is the one that reaches everything", () => {
    expect(chooseTip(ctx())?.id).toBe("palette");
  });

  it("teaches the palette first even on a page with its own shortcut", () => {
    /*
     * This is the regression. Checking the current page BEFORE the palette
     * meant almost everybody's first tip was "press G then D for the
     * dashboard" — the page signing in already lands you on. A tip teaching
     * the key for where you are, and got to by default, is the worst possible
     * introduction to the idea.
     */
    expect(chooseTip(ctx({ pathname: "/dashboard" }))?.id).toBe("palette");
    expect(chooseTip(ctx({ pathname: "/members" }))?.id).toBe("palette");
  });

  it("then prefers the shortcut for the page they are standing on", () => {
    /*
     * They clicked through the menu to get to Members. That is the moment
     * "press G then M" means something, because it names the thing they just
     * did the long way.
     */
    const state = settled({ learned: ["palette"] });
    expect(chooseTip(ctx({ pathname: "/members", state }))?.id).toBe("go-members");
  });

  it("recognises the page from a record inside it", () => {
    const state = settled({ learned: ["palette"] });
    expect(chooseTip(ctx({ pathname: "/members/abc123", state }))?.id).toBe(
      "go-members",
    );
  });

  it("falls back to registry order on a page with no shortcut of its own", () => {
    const state = settled({ learned: ["palette"] });
    const tip = chooseTip(ctx({ pathname: "/notifications", state }));
    expect(tip).not.toBeNull();
    expect(tip?.id).not.toBe("palette");
  });

  it("moves on to the next page's shortcut once that one is known", () => {
    const state = settled({ learned: ["go-members", "palette"] });
    const tip = chooseTip(ctx({ pathname: "/members", state }));
    expect(tip?.id).not.toBe("go-members");
    expect(tip?.id).not.toBe("palette");
  });

  it("only ever offers something the person is allowed", () => {
    const usherOnly = ALL.filter((s) => !s.perm || s.perm === "attendance.manage");
    let state = settled();
    let now = 1_700_000_000_000;
    const allowed = new Set(usherOnly.map((s) => s.id));

    for (let i = 0; i < MAX_TIPS; i++) {
      const tip: Shortcut | null = chooseTip(
        ctx({ state, now, available: usherOnly }),
      );
      if (!tip) break;
      expect(allowed.has(tip.id), `${tip.id} was offered but is not available`).toBe(
        true,
      );
      state = markShown(state, tip.id, now);
      now += TIP_COOLDOWN_MS + 1;
    }
  });
});

describe("the page a shortcut belongs to", () => {
  it("matches exactly", () => {
    expect(samePage("/members", "/members")).toBe(true);
  });

  it("matches a record inside it", () => {
    expect(samePage("/members", "/members/abc")).toBe(true);
    expect(samePage("/members", "/members/households/1")).toBe(true);
  });

  it("ignores the query string, so a 'do' shortcut matches its own page", () => {
    expect(samePage("/members?new=1", "/members")).toBe(true);
    expect(samePage("/facilities?new=1", "/facilities")).toBe(true);
  });

  it("does not match a different page that starts with the same letters", () => {
    // The bug a naive startsWith would have: /first-timers is not /first.
    expect(samePage("/members", "/members-archive")).toBe(false);
    expect(samePage("/giving", "/giving-projects")).toBe(false);
    expect(samePage("/follow-up", "/followup")).toBe(false);
  });
});

describe("remembering", () => {
  it("records a shortcut as learned, once", () => {
    const once = markLearned(EMPTY_TIP_STATE, "palette");
    const twice = markLearned(once, "palette");
    expect(once.learned).toEqual(["palette"]);
    expect(twice.learned).toEqual(["palette"]);
    expect(twice).toBe(once); // no pointless write
  });

  it("records a tip as shown and starts the clock", () => {
    const s = markShown(EMPTY_TIP_STATE, "palette", 123);
    expect(s.shown).toEqual(["palette"]);
    expect(s.lastShownAt).toBe(123);
  });

  it("restarts the clock if the same tip somehow shows twice", () => {
    const first = markShown(EMPTY_TIP_STATE, "palette", 123);
    const again = markShown(first, "palette", 456);
    expect(again.shown).toEqual(["palette"]);
    expect(again.lastShownAt).toBe(456);
  });

  it("counts visits, and stops counting once it no longer matters", () => {
    let s = EMPTY_TIP_STATE;
    for (let i = 0; i < MIN_VISITS + 50; i++) s = markVisit(s);
    expect(s.visits).toBeGreaterThan(MIN_VISITS);
    // Not 58 — a counter climbing for years is just a bigger number in
    // somebody's browser.
    expect(s.visits).toBeLessThanOrEqual(MIN_VISITS + 1);
  });

  it("turns off and back on again", () => {
    expect(turnTipsOff(EMPTY_TIP_STATE).off).toBe(true);
    expect(turnTipsOn(turnTipsOff(EMPTY_TIP_STATE)).off).toBe(false);
  });
});

describe("reading what is in storage", () => {
  it("survives a round trip", () => {
    const s = settled({ learned: ["palette"], shown: ["go-members"], lastShownAt: 9 });
    expect(parseTipState(serialiseTipState(s))).toEqual(s);
  });

  it("treats nothing as a fresh start", () => {
    expect(parseTipState(null)).toEqual(EMPTY_TIP_STATE);
    expect(parseTipState("")).toEqual(EMPTY_TIP_STATE);
  });

  it("does not throw on anything a browser might hand it", () => {
    /*
     * This blob lives in somebody else's browser. It can be hand-edited,
     * truncated by a full disk, or left over from an older shape of the type.
     * Being taught a shortcut twice is a fine worst case; throwing inside the
     * app shell on every page is not.
     */
    for (const raw of [
      "not json",
      "null",
      "[]",
      '"a string"',
      "42",
      "{",
      '{"learned":"palette"}',
      '{"visits":"many","off":"yes"}',
      '{"learned":[1,2,{"x":1}],"shown":null}',
      '{"lastShownAt":"yesterday"}',
      '{"visits":-5}',
      '{"lastShownAt":null,"visits":1.7}',
    ]) {
      expect(() => parseTipState(raw), raw).not.toThrow();
      const s = parseTipState(raw);
      expect(Array.isArray(s.learned), raw).toBe(true);
      expect(Array.isArray(s.shown), raw).toBe(true);
      expect(typeof s.off, raw).toBe("boolean");
      expect(Number.isInteger(s.visits), raw).toBe(true);
      expect(s.visits, raw).toBeGreaterThanOrEqual(0);
    }
  });

  it("drops rubbish out of the id lists rather than keeping it", () => {
    const s = parseTipState('{"learned":["palette",7,null,"go-members"]}');
    expect(s.learned).toEqual(["palette", "go-members"]);
  });

  it("keeps an unknown id without choking on it", () => {
    /*
     * An id from a shortcut that has since been removed. It simply never
     * matches anything, which is the correct outcome and needs no cleanup.
     */
    const s = parseTipState('{"learned":["go-somewhere-that-went-away"]}');
    expect(s.learned).toEqual(["go-somewhere-that-went-away"]);
    expect(shortcutById(s.learned[0])).toBeUndefined();
    // `s` comes out of storage with visits: 0, so put the settled visit count
    // back — this test is about the unknown id, not about rule 3.
    expect(
      chooseTip(ctx({ state: { ...s, visits: MIN_VISITS } })),
    ).not.toBeNull();
  });
});
