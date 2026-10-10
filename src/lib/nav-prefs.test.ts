import { describe, expect, it } from "vitest";
import {
  LOG_MAX,
  MIN_AUTO_ITEMS,
  destinationFor,
  forget,
  pinsFull,
  rankQuickAccess,
  reconcilePins,
  recordVisit,
  referencePoint,
  score,
  togglePin,
  QUICK_ACCESS_MAX,
  type VisitLog,
} from "@/lib/nav-prefs";

const NOW = Date.UTC(2026, 9, 10);
const DAY = 86_400_000;
const daysAgo = (n: number) => NOW - n * DAY;

/** The menu, as far as these tests care. */
const HREFS = [
  "/dashboard",
  "/members",
  "/first-timers",
  "/giving",
  "/finance",
  "/attendance",
  "/media",
];

describe("which destination a path belongs to", () => {
  it("counts a member's own page as a visit to Members", () => {
    expect(destinationFor("/members/abc123", HREFS)).toBe("/members");
  });

  it("does not mistake /first-timers for a longer form of something else", () => {
    expect(destinationFor("/first-timers", HREFS)).toBe("/first-timers");
  });

  it("takes the longest match, not the first", () => {
    const hrefs = ["/settings", "/settings/giving"];
    expect(destinationFor("/settings/giving", hrefs)).toBe("/settings/giving");
  });

  /*
   * The boundary has to be a slash, not a character count. Without it a page
   * at /giving-report would be recorded as a visit to /giving, and somebody
   * who only ever reads reports would get a shortcut to the page where money
   * is entered.
   */
  it("requires a path boundary rather than a shared prefix", () => {
    expect(destinationFor("/giving-report", HREFS)).toBeNull();
  });

  it("returns null for a page that is not a menu entry", () => {
    expect(destinationFor("/profile", HREFS)).toBeNull();
  });
});

describe("recording a visit", () => {
  it("counts up and moves the clock forward", () => {
    const once = recordVisit({}, "/giving", daysAgo(3));
    const twice = recordVisit(once, "/giving", NOW);
    expect(twice["/giving"]).toEqual({ n: 2, last: NOW });
  });

  it("leaves the log it was given alone", () => {
    const before: VisitLog = { "/giving": { n: 1, last: daysAgo(3) } };
    recordVisit(before, "/giving", NOW);
    expect(before["/giving"].n).toBe(1);
  });

  it("stays bounded, keeping the strongest", () => {
    let log: VisitLog = {};
    // One stale page per slot, plus one more, plus a clear favourite.
    for (let i = 0; i <= LOG_MAX; i++) {
      log[`/old-${i}`] = { n: 1, last: daysAgo(200) };
    }
    log = recordVisit(log, "/giving", NOW);
    expect(Object.keys(log).length).toBe(LOG_MAX);
    expect(log["/giving"]).toBeDefined();
  });
});

describe("the score", () => {
  it("halves over the half-life", () => {
    const fresh = score({ n: 4, last: NOW }, NOW);
    const fortnightOld = score({ n: 4, last: daysAgo(14) }, NOW);
    expect(fortnightOld).toBeCloseTo(fresh / 2, 6);
  });

  /*
   * The behaviour the whole feature rests on: somebody who moved from the
   * finance desk to the welcome desk gets a shortcut row that moved with them,
   * rather than one that still remembers last quarter.
   */
  it("lets two recent visits beat fifty old ones", () => {
    const old = score({ n: 50, last: daysAgo(90) }, NOW);
    const recent = score({ n: 2, last: daysAgo(1) }, NOW);
    expect(recent).toBeGreaterThan(old);
  });

  it("is zero for something never visited", () => {
    expect(score(undefined, NOW)).toBe(0);
  });
});

/**
 * The property the browser side leans on.
 *
 * `useQuickAccess` must be a pure function of what is stored — calling
 * `Date.now()` mid-render is a lint error in this project and a genuine hazard
 * besides — so it ranks against the newest visit in the log instead of the
 * clock. That is only sound because the reference point factors out of the
 * score as a common multiplier. If anyone ever changes the decay to something
 * where it does not, this is the test that says so.
 */
describe("the reference point", () => {
  const log: VisitLog = {
    "/giving": { n: 12, last: daysAgo(1) },
    "/members": { n: 30, last: daysAgo(40) },
    "/attendance": { n: 4, last: daysAgo(3) },
    "/media": { n: 7, last: daysAgo(9) },
  };

  it("is the newest visit in the log", () => {
    expect(referencePoint(log)).toBe(daysAgo(1));
    expect(referencePoint({})).toBe(0);
  });

  it("cannot change the order, whatever it is set to", () => {
    const order = (now: number) =>
      rankQuickAccess({ log, pins: [], hrefs: HREFS, now }).map((r) => r.href);

    const truth = order(NOW);
    expect(order(referencePoint(log))).toEqual(truth);
    expect(order(NOW + 365 * DAY)).toEqual(truth);
    expect(order(daysAgo(1))).toEqual(truth);
  });
});

describe("what quick access shows", () => {
  const busy: VisitLog = {
    "/giving": { n: 12, last: daysAgo(1) },
    "/members": { n: 9, last: daysAgo(2) },
    "/attendance": { n: 6, last: daysAgo(1) },
    "/media": { n: 3, last: daysAgo(20) },
  };

  it("puts the strongest habit first", () => {
    const rows = rankQuickAccess({ log: busy, pins: [], hrefs: HREFS, now: NOW });
    expect(rows.map((r) => r.href)).toEqual([
      "/giving",
      "/members",
      "/attendance",
      "/media",
    ]);
    expect(rows.every((r) => !r.pinned)).toBe(true);
  });

  /*
   * Declared beats inferred, and not just in the ordering: a pin may not be
   * pushed out by a guess, however strong the guess is.
   */
  it("puts pins first, in the order they were pinned", () => {
    const rows = rankQuickAccess({
      log: busy,
      pins: ["/finance", "/first-timers"],
      hrefs: HREFS,
      now: NOW,
    });
    expect(rows.slice(0, 2)).toEqual([
      { href: "/finance", pinned: true },
      { href: "/first-timers", pinned: true },
    ]);
  });

  it("never lists a pinned destination twice", () => {
    const rows = rankQuickAccess({
      log: busy,
      pins: ["/giving"],
      hrefs: HREFS,
      now: NOW,
    });
    expect(rows.filter((r) => r.href === "/giving").length).toBe(1);
  });

  it("stops at the maximum", () => {
    const rows = rankQuickAccess({
      log: busy,
      pins: [],
      hrefs: HREFS,
      now: NOW,
      max: 2,
    });
    expect(rows.length).toBe(2);
  });

  /*
   * The log outlives a permission. Somebody moved off the finance team must
   * not be offered a shortcut to a page that will now refuse them — which is
   * why the allowed list is passed in rather than read from the menu.
   */
  it("drops a destination this person may no longer open", () => {
    const rows = rankQuickAccess({
      log: busy,
      pins: ["/finance"],
      hrefs: HREFS.filter((h) => h !== "/finance" && h !== "/giving"),
      now: NOW,
    });
    expect(rows.map((r) => r.href)).not.toContain("/finance");
    expect(rows.map((r) => r.href)).not.toContain("/giving");
  });

  it("ignores a destination visited only once", () => {
    const log: VisitLog = {
      "/giving": { n: 5, last: daysAgo(1) },
      "/members": { n: 4, last: daysAgo(1) },
      "/media": { n: 1, last: NOW },
    };
    const rows = rankQuickAccess({ log, pins: [], hrefs: HREFS, now: NOW });
    expect(rows.map((r) => r.href)).not.toContain("/media");
  });

  it("shows nothing at all until a habit is actually visible", () => {
    const log: VisitLog = { "/giving": { n: 9, last: NOW } };
    expect(
      rankQuickAccess({ log, pins: [], hrefs: HREFS, now: NOW }),
    ).toEqual([]);
    expect(MIN_AUTO_ITEMS).toBeGreaterThan(1);
  });

  /*
   * ...but a pin is an instruction, not a vote. One pin shows on its own.
   */
  it("shows a lone pin without waiting for a second row", () => {
    const rows = rankQuickAccess({
      log: {},
      pins: ["/finance"],
      hrefs: HREFS,
      now: NOW,
    });
    expect(rows).toEqual([{ href: "/finance", pinned: true }]);
  });

  it("never promotes the dashboard on its own", () => {
    const log: VisitLog = {
      "/dashboard": { n: 200, last: NOW },
      "/giving": { n: 4, last: NOW },
      "/members": { n: 3, last: NOW },
    };
    const rows = rankQuickAccess({ log, pins: [], hrefs: HREFS, now: NOW });
    expect(rows.map((r) => r.href)).not.toContain("/dashboard");
  });

  it("but shows it when somebody pins it", () => {
    const rows = rankQuickAccess({
      log: {},
      pins: ["/dashboard"],
      hrefs: HREFS,
      now: NOW,
    });
    expect(rows).toEqual([{ href: "/dashboard", pinned: true }]);
  });

  it("holds a stable order when two scores tie", () => {
    const log: VisitLog = {
      "/members": { n: 3, last: NOW },
      "/giving": { n: 3, last: NOW },
      "/attendance": { n: 3, last: NOW },
    };
    const once = rankQuickAccess({ log, pins: [], hrefs: HREFS, now: NOW });
    const again = rankQuickAccess({ log, pins: [], hrefs: HREFS, now: NOW });
    expect(once).toEqual(again);
  });
});

describe("pinning", () => {
  it("adds and removes", () => {
    expect(togglePin([], "/giving")).toEqual(["/giving"]);
    expect(togglePin(["/giving"], "/giving")).toEqual([]);
  });

  it("keeps the order they were added in", () => {
    expect(togglePin(["/a"], "/b")).toEqual(["/a", "/b"]);
  });

  it("holds four", () => {
    /*
     * The row sits above the first group, so every slot it fills pushes the
     * real menu down. Four is the number the churches asked for; this is here
     * so lowering or raising it is a deliberate edit to a test and not a
     * number somebody changed in passing.
     */
    expect(QUICK_ACCESS_MAX).toBe(4);
  });

  it("refuses a fifth rather than quietly dropping one", () => {
    const four = ["/a", "/b", "/c", "/d"];
    expect(pinsFull(four)).toBe(true);
    expect(togglePin(four, "/e")).toEqual(four);
  });

  /*
   * The cap came down from six, so there are browsers holding five and six.
   * The old implementation took the first four of `[...pins, href]`, which
   * means pinning a seventh thing would have deleted two pins somebody had
   * declared — as a side effect of an unrelated press. This function does not
   * delete what it was not asked to; reconciling a longer stored list with a
   * four-row menu is `useQuickAccess`'s job, not this one's.
   */
  it("leaves a longer list from the older cap alone", () => {
    const six = ["/a", "/b", "/c", "/d", "/e", "/f"];
    expect(togglePin(six, "/g")).toEqual(six);
  });

  it("always lets one go, however long the list is", () => {
    const six = ["/a", "/b", "/c", "/d", "/e", "/f"];
    expect(togglePin(six, "/c")).toEqual(["/a", "/b", "/d", "/e", "/f"]);
  });

  it("makes room again on the way down", () => {
    const four = ["/a", "/b", "/c", "/d"];
    const three = togglePin(four, "/d");
    expect(pinsFull(three)).toBe(false);
    expect(togglePin(three, "/e")).toEqual(["/a", "/b", "/c", "/e"]);
  });

  it("shows only the first four of a longer stored list", () => {
    /*
     * Those extra pins are kept rather than trimmed on sight — if the cap
     * ever goes back up they come back — so what stops them is the ranking,
     * not the storage.
     */
    const rows = rankQuickAccess({
      log: {},
      pins: ["/members", "/giving", "/finance", "/attendance", "/media"],
      hrefs: HREFS,
      now: NOW,
    });
    expect(rows.map((r) => r.href)).toEqual([
      "/members",
      "/giving",
      "/finance",
      "/attendance",
    ]);
  });
});

/*
 * The stored list is not the pins on screen, and the cap is about the second.
 *
 * One localStorage key serves every church this person can switch between and
 * survives a permission being withdrawn, so a stored pin can have no row to
 * unpin it from. A cap that counted those would be a refusal pointing at a
 * control that does not exist — a locked door — which is the shape of bug this
 * splits the list to avoid.
 */
describe("reconciling the stored pins with the menu in front of somebody", () => {
  const here = new Set(["/members", "/giving", "/attendance", "/media", "/forms"]);

  it("keeps the ones with a row, in the order they were pinned", () => {
    const { pins, carried } = reconcilePins(["/giving", "/members"], here);
    expect(pins).toEqual(["/giving", "/members"]);
    expect(carried).toEqual([]);
  });

  it("carries the ones with no row here instead of counting them", () => {
    /*
     * Another church's module after a switch, or one a withdrawn permission
     * has taken away. Three real pins plus two of these is not a full list:
     * there is a fourth slot, and it must be offered.
     */
    const { pins, carried } = reconcilePins(
      ["/elsewhere", "/members", "/giving", "/gone", "/attendance"],
      here,
    );
    expect(pins).toEqual(["/members", "/giving", "/attendance"]);
    expect(carried).toEqual(["/elsewhere", "/gone"]);
    expect(pinsFull(pins)).toBe(false);
  });

  it("does not let the carried ones fill the four", () => {
    const { pins } = reconcilePins(
      ["/a", "/b", "/c", "/d", "/e", "/members"],
      here,
    );
    expect(pins).toEqual(["/members"]);
  });

  it("drops what is past the cap, so the way out is one unpin", () => {
    /*
     * A browser holding six from yesterday. Keeping the fifth and sixth would
     * make "unpin one to make room" false for ever: unpinning one of the four
     * on screen would only promote the fifth into its place.
     */
    const { pins, carried } = reconcilePins(
      ["/members", "/giving", "/attendance", "/media", "/forms"],
      here,
    );
    expect(pins).toEqual(["/members", "/giving", "/attendance", "/media"]);
    expect(carried).toEqual([]);
    expect(pinsFull(pins)).toBe(true);
    /* And after one unpin there is room, which is what the message promises. */
    expect(pinsFull(togglePin(pins, "/media"))).toBe(false);
  });

  it("is empty for an empty list, and for a menu with nothing in it", () => {
    expect(reconcilePins([], here)).toEqual({ pins: [], carried: [] });
    expect(reconcilePins(["/members"], new Set())).toEqual({
      pins: [],
      carried: ["/members"],
    });
  });
});

describe("forgetting", () => {
  /*
   * "Stop suggesting this" has to clear the count as well as the row.
   * Dismissing without forgetting puts it straight back within a week, and an
   * app that argues with somebody about their own menu has stopped being
   * theirs.
   */
  it("removes a destination from the log entirely", () => {
    const log: VisitLog = { "/giving": { n: 30, last: NOW } };
    const after = forget(log, "/giving");
    expect(after["/giving"]).toBeUndefined();
    expect(
      rankQuickAccess({ log: after, pins: [], hrefs: HREFS, now: NOW }),
    ).toEqual([]);
  });

  it("leaves the log it was given alone", () => {
    const log: VisitLog = { "/giving": { n: 30, last: NOW } };
    forget(log, "/giving");
    expect(log["/giving"]).toBeDefined();
  });

  it("is a no-op for something that was never there", () => {
    const log: VisitLog = { "/giving": { n: 1, last: NOW } };
    expect(forget(log, "/media")).toBe(log);
  });
});
