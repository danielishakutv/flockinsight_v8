/**
 * Keyboard shortcuts: the one list.
 *
 * Pure data and pure matching logic — no React, no DOM — so the part that is
 * easy to get wrong is tested in plain Node. The thin React layer lives in
 * `components/app/shortcuts-provider.tsx`.
 *
 * Everything that teaches or performs a shortcut reads THIS file: the global
 * key handler, the ⌘K palette, the `?` cheat sheet, the occasional tip, and
 * the help guide. That is deliberate. A second parallel list of the same facts
 * is what made Facilities, First-timers and Livestreams invisible for weeks
 * (see the note at the top of `lib/nav.ts`), and a cheat sheet promising a key
 * that does nothing is the same bug wearing a different hat.
 *
 * The palette's *destinations* are not listed here either — it reads
 * `navSections` straight from `lib/nav.ts`, so a new module becomes
 * searchable the moment it appears in the menu, with nobody having to remember
 * this file exists.
 */
import type { TKey } from "@/lib/i18n/translate";
import type { FeatureKey } from "@/lib/entitlements";

export type ShortcutGroup = "find" | "go" | "do" | "view" | "help";

export type Shortcut = {
  /**
   * Stable for ever, because the tips remember it.
   *
   * A tip retires itself once the person has actually used the shortcut, which
   * means these ids are written into somebody's browser. Renaming one makes the
   * app teach a key they already know.
   */
  id: string;
  /**
   * The keys, in order. One token per press: `["g", "m"]` is "press g, then m".
   * `"mod+k"` is a single chord — ⌘K on a Mac, Ctrl+K everywhere else.
   */
  keys: readonly string[];
  /** A key into the dictionary, not a label. The sheet is translated too. */
  labelKey: TKey;
  group: ShortcutGroup;
  /**
   * Where it goes. Absent for the four the provider performs itself (the
   * palette, the page search, the sheet, Escape).
   */
  href?: string;
  /** Don't teach somebody a shortcut their role cannot use. */
  perm?: string | string[];
  /** Nor one their plan does not include. */
  feature?: FeatureKey;
  /** Words a church would actually type looking for this, for the palette. */
  keywords?: readonly string[];
};

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

/**
 * Ten or so to go somewhere, half a dozen to do something, and ⌘K for the
 * other fifteen modules.
 *
 * The temptation is a shortcut per module. Twenty-five two-key sequences is a
 * list nobody learns, so the hot paths — the pages a church opens every Sunday
 * — get a key, and everything else is one ⌘K away. Mnemonics are the first
 * letter wherever the first letter was free; where it wasn't, the sheet says
 * the word the letter came from ("g b — bookings") rather than leaving someone
 * to guess.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  /* --- Find ------------------------------------------------------- */
  {
    id: "palette",
    keys: ["mod+k"],
    labelKey: "shortcuts.palette",
    group: "find",
    keywords: ["search", "find", "jump", "command", "anything"],
  },
  {
    id: "search-page",
    keys: ["/"],
    labelKey: "shortcuts.searchPage",
    group: "find",
    keywords: ["search", "filter", "find on this page"],
  },

  /* --- Go somewhere ----------------------------------------------- */
  {
    id: "go-dashboard",
    keys: ["g", "d"],
    labelKey: "nav.dashboard",
    group: "go",
    href: "/dashboard",
    keywords: ["home", "overview"],
  },
  {
    id: "go-members",
    keys: ["g", "m"],
    labelKey: "nav.members",
    group: "go",
    href: "/members",
    perm: "members.view",
    keywords: ["congregation", "people", "register"],
  },
  {
    id: "go-attendance",
    keys: ["g", "a"],
    labelKey: "nav.attendance",
    group: "go",
    href: "/attendance",
    perm: "attendance.view",
    keywords: ["headcount", "register", "service"],
  },
  {
    id: "go-giving",
    keys: ["g", "g"],
    labelKey: "nav.giving",
    group: "go",
    href: "/giving",
    perm: "giving.view",
    keywords: ["offering", "tithe", "donation", "money"],
  },
  {
    id: "go-groups",
    keys: ["g", "r"],
    labelKey: "nav.groups",
    group: "go",
    href: "/groups",
    perm: "groups.view",
    keywords: ["ministry", "department", "cell", "unit"],
  },
  {
    id: "go-first-timers",
    keys: ["g", "v"],
    labelKey: "nav.firstTimers",
    group: "go",
    href: "/first-timers",
    perm: "followup.view",
    feature: "followUp",
    keywords: ["visitor", "new face", "welcome", "guest"],
  },
  {
    id: "go-follow-up",
    keys: ["g", "f"],
    labelKey: "nav.followUp",
    group: "go",
    href: "/follow-up",
    perm: "followup.view",
    feature: "followUp",
    keywords: ["visitor care", "call", "check on"],
  },
  {
    id: "go-communication",
    keys: ["g", "c"],
    labelKey: "nav.communication",
    group: "go",
    href: "/communication",
    perm: "communication.view",
    keywords: ["sms", "text", "email", "message", "broadcast"],
  },
  {
    id: "go-facilities",
    keys: ["g", "b"],
    labelKey: "nav.facilities",
    group: "go",
    href: "/facilities",
    perm: "facilities.view",
    feature: "facilities",
    keywords: ["booking", "hall", "room", "bus", "venue", "hire"],
  },
  {
    id: "go-training",
    keys: ["g", "t"],
    labelKey: "nav.training",
    group: "go",
    href: "/training",
    perm: "training.view",
    feature: "training",
    keywords: ["class", "course", "worker", "discipleship"],
  },
  {
    id: "go-events",
    keys: ["g", "e"],
    labelKey: "nav.events",
    group: "go",
    href: "/my-events",
    perm: "settings.manage",
    keywords: ["program", "flyer", "calendar"],
  },
  {
    id: "go-settings",
    keys: ["g", "s"],
    labelKey: "nav.settings",
    group: "go",
    href: "/settings",
    perm: ["settings.manage", "team.manage"],
    keywords: ["setup", "team", "services", "billing"],
  },
  {
    id: "go-help",
    keys: ["g", "h"],
    labelKey: "nav.help",
    group: "go",
    href: "/help",
    keywords: ["guide", "support", "how do i"],
  },

  /* --- Do something ----------------------------------------------- *
   *
   * Each of these is a plain address, so the palette and the key press are the
   * same code path, and "add a member" is a link a church can bookmark. The
   * `?new=1` convention is read by `useOpenedFromShortcut` on the page, which
   * opens the form and takes the parameter back out of the address bar so a
   * refresh does not open it a second time.
   */
  {
    id: "new-member",
    keys: ["n", "m"],
    labelKey: "shortcuts.newMember",
    group: "do",
    href: "/members?new=1",
    perm: "members.manage",
    keywords: ["add member", "register", "new person", "join"],
  },
  {
    id: "new-first-timer",
    keys: ["n", "v"],
    labelKey: "shortcuts.newFirstTimer",
    group: "do",
    href: "/first-timers?new=1",
    perm: "followup.manage",
    feature: "followUp",
    keywords: ["visitor", "new face", "welcome", "guest", "first time"],
  },
  {
    id: "new-attendance",
    keys: ["n", "a"],
    labelKey: "shortcuts.newAttendance",
    group: "do",
    href: "/attendance/record",
    perm: "attendance.manage",
    keywords: ["headcount", "record service", "count"],
  },
  {
    id: "new-giving",
    keys: ["n", "g"],
    labelKey: "shortcuts.newGiving",
    group: "do",
    href: "/giving?new=1",
    perm: "giving.manage",
    keywords: ["offering", "tithe", "record money", "donation"],
  },
  {
    id: "new-group",
    keys: ["n", "r"],
    labelKey: "shortcuts.newGroup",
    group: "do",
    href: "/groups?new=1",
    perm: "groups.manage",
    keywords: ["ministry", "department", "new unit"],
  },
  {
    id: "new-booking",
    keys: ["n", "b"],
    labelKey: "shortcuts.newBooking",
    group: "do",
    href: "/facilities?new=1",
    perm: "facilities.view",
    feature: "facilities",
    keywords: ["book the hall", "reserve", "hire", "venue"],
  },

  /*
   * Narrow or widen the sidebar.
   *
   * In "view" rather than "do": it writes nothing and goes nowhere. It is
   * also the shortcut of most use to the people who will never read the cheat
   * sheet — a laptop at 1280px gains 220px of table with one chord.
   */
  {
    id: "toggle-sidebar",
    keys: ["mod+\\"],
    labelKey: "shortcuts.toggleSidebar",
    group: "view",
    keywords: ["sidebar", "menu", "collapse", "expand", "narrow", "wide", "icons"],
  },

  /* --- Help ------------------------------------------------------- */
  {
    id: "sheet",
    keys: ["?"],
    labelKey: "shortcuts.sheet",
    group: "help",
    keywords: ["shortcuts", "keys", "keyboard"],
  },
  {
    id: "close",
    keys: ["escape"],
    labelKey: "shortcuts.close",
    group: "help",
    keywords: ["cancel", "dismiss", "back"],
  },
];

/** The order the sheet and the guide list the groups in. */
export const SHORTCUT_GROUPS: readonly { key: ShortcutGroup; titleKey: TKey }[] =
  [
    { key: "find", titleKey: "shortcuts.groupFind" },
    { key: "go", titleKey: "shortcuts.groupGo" },
    { key: "do", titleKey: "shortcuts.groupDo" },
    /*
     * "Do" is things that write a record, and the tests enforce that: a `do`
     * shortcut must have an href and must ask for a `.manage` permission,
     * because teaching somebody a key that lands on a page where the button is
     * missing reads as the app being broken.
     *
     * Narrowing the sidebar writes nothing and goes nowhere, so it is not a
     * `do`. Its own group rather than a documented exception, so the guarantee
     * on `do` stays a guarantee.
     */
    { key: "view", titleKey: "shortcuts.groupView" },
    { key: "help", titleKey: "shortcuts.groupHelp" },
  ];

/* ------------------------------------------------------------------ *
 * Reading a key press
 * ------------------------------------------------------------------ */

/** Just the fields of a KeyboardEvent this needs, so a test needs no DOM. */
export type KeyPress = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

/**
 * One press → one token, or `null` for "not ours".
 *
 * `null` is the important half. Anything held with Alt, or with Ctrl/⌘ other
 * than K, belongs to the browser or the operating system, and a church app
 * that swallows Ctrl+P or ⌘L has broken something people rely on far more than
 * it has gained. The same goes for a bare modifier, Tab, and the arrow keys.
 */
export function keyToken(e: KeyPress): string | null {
  const mod = Boolean(e.metaKey || e.ctrlKey);
  if (e.altKey) return null;

  if (mod) {
    /*
     * The two chords we claim, and nothing else.
     *
     * ⌘K opens the palette. ⌘\ narrows the sidebar — chosen because, unlike
     * the obvious ⌘B, it is bound to nothing in any browser and is not bold in
     * a rich-text editor, of which this app has one. Everything else held with
     * Ctrl or ⌘ belongs to the browser: ⌘P prints the attendance sheet and ⌘L
     * is the address bar, and a church app that swallows either has broken
     * something people rely on far more than it has gained.
     */
    const k = e.key.toLowerCase();
    if (k === "k") return "mod+k";
    if (k === "\\") return "mod+\\";
    return null;
  }

  const key = e.key;
  if (key === "Escape") return "escape";
  if (key === "?") return "?";
  if (key === "/") return "/";
  // Single printable letters only. `key.length === 1` excludes Tab, Enter,
  // ArrowUp, Shift and the rest without having to name them all.
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toLowerCase();
  return null;
}

/**
 * Is the person typing?
 *
 * The first and worst bug in every shortcut system: somebody writes "Grace
 * Mensah" into the name field and the `m` navigates away, taking the half-filled
 * form with it. Takes primitives rather than an Element so it is testable in
 * Node, and errs towards "yes, they are typing" for anything it does not
 * recognise.
 */
export function isTypingTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/* ------------------------------------------------------------------ *
 * Matching a sequence
 * ------------------------------------------------------------------ */

export type MatchResult =
  /** This is the one. Fire it and clear the buffer. */
  | { kind: "hit"; shortcut: Shortcut }
  /** The start of something — `g` with `g m` in the list. Keep the buffer. */
  | { kind: "prefix" }
  /** Nothing starts with this. Clear the buffer. */
  | { kind: "miss" };

/**
 * What the buffer so far means.
 *
 * A hit is checked before a prefix, so a one-key shortcut always wins over
 * being the first key of a two-key one. Nothing in the registry is both, and
 * the test says so — but the order here is what makes that safe to rely on.
 */
export function matchKeys(
  buffer: readonly string[],
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): MatchResult {
  if (buffer.length === 0) return { kind: "miss" };

  const hit = shortcuts.find(
    (s) =>
      s.keys.length === buffer.length &&
      s.keys.every((k, i) => k === buffer[i]),
  );
  if (hit) return { kind: "hit", shortcut: hit };

  const prefix = shortcuts.some(
    (s) =>
      s.keys.length > buffer.length &&
      buffer.every((k, i) => s.keys[i] === k),
  );
  return prefix ? { kind: "prefix" } : { kind: "miss" };
}

/**
 * How long a half-typed sequence waits for its second key.
 *
 * Long enough that `g` then `m` is comfortable for somebody who is not a
 * touch-typist — this app is used by church secretaries, not by people who
 * live in a terminal — and short enough that a stray `g` does not lie in wait
 * to swallow the next thing they press.
 */
export const SEQUENCE_TIMEOUT_MS = 1500;

/* ------------------------------------------------------------------ *
 * Who may be taught what
 * ------------------------------------------------------------------ */

/**
 * The shortcuts this person can actually use.
 *
 * Deliberately the same two questions the sidebar asks, in the same order, and
 * answered by the same function — `navVisible` — so the sheet cannot promise a
 * key to a module the menu is hiding. A shortcut with no `perm` and no
 * `feature` (the palette, Escape) passes straight through.
 *
 * `navVisible` is imported lazily by the caller rather than here, because
 * `lib/nav.ts` pulls in Lucide icons and this module is read by the help guide
 * on the server. The caller passes it in.
 */
export function availableShortcuts(
  visible: (item: { perm?: string | string[]; feature?: FeatureKey }) => boolean,
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): Shortcut[] {
  return shortcuts.filter((s) => visible(s));
}

/* ------------------------------------------------------------------ *
 * Showing a key to a human
 * ------------------------------------------------------------------ */

/**
 * The symbols on the keys.
 *
 * `mod` is the only one that differs by platform, and getting it wrong is not
 * cosmetic: telling a Mac user to press Ctrl+K is telling them to press the
 * wrong key.
 */
export function keyLabel(token: string, isMac: boolean): string {
  switch (token) {
    case "mod+k":
      return isMac ? "⌘K" : "Ctrl K";
    case "mod+\\":
      return isMac ? "⌘\\" : "Ctrl \\";
    case "escape":
      return "Esc";
    case "/":
      return "/";
    case "?":
      return "?";
    default:
      return token.toUpperCase();
  }
}

/** The whole sequence, for a sentence: "press G then M". */
export function keysLabel(
  keys: readonly string[],
  isMac: boolean,
  then = "then",
): string {
  return keys.map((k) => keyLabel(k, isMac)).join(` ${then} `);
}

/** Find one by id — for the tips, which store ids. */
export function shortcutById(
  id: string,
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): Shortcut | undefined {
  return shortcuts.find((s) => s.id === id);
}
