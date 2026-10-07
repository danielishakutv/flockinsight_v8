import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  availableShortcuts,
  isTypingTarget,
  keyLabel,
  keyToken,
  keysLabel,
  matchKeys,
  shortcutById,
  type Shortcut,
} from "@/lib/shortcuts";
import { navVisible } from "@/lib/nav";
import { ALL_PERMISSIONS } from "@/lib/permissions-catalog";
import { FEATURES } from "@/lib/entitlements";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * A shortcut that does nothing is worse than no shortcut.
 *
 * The cheat sheet, the tips and the help guide all promise these keys in
 * writing. A key that navigates to a dead route, a label that resolves to
 * "Go members" because the dictionary key was mistyped, or two shortcuts
 * fighting over `g m` are all silent — nothing throws, and the person who
 * believed the sheet is the one who finds out.
 */

function lookup(key: string): unknown {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const seq = (s: Shortcut) => s.keys.join(" ");

describe("the registry", () => {
  it("gives every shortcut a unique id", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size, `duplicate id in: ${ids.join(", ")}`).toBe(
      ids.length,
    );
  });

  it("never gives two shortcuts the same keys", () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      const existing = seen.get(seq(s));
      expect(
        existing,
        `"${seq(s)}" is claimed by both ${existing} and ${s.id}`,
      ).toBeUndefined();
      seen.set(seq(s), s.id);
    }
  });

  it("never makes a whole shortcut the beginning of another one", () => {
    /*
     * If `g` were a shortcut on its own AND the start of `g m`, one of the two
     * can never fire — the matcher would have to choose, and whichever it
     * chose would be wrong half the time. Keeping the registry free of the
     * shape means the ambiguity cannot arise.
     */
    for (const a of SHORTCUTS) {
      for (const b of SHORTCUTS) {
        if (a === b) continue;
        const isPrefix =
          b.keys.length > a.keys.length &&
          a.keys.every((k, i) => b.keys[i] === k);
        expect(
          isPrefix,
          `"${seq(a)}" (${a.id}) is a complete shortcut AND the start of "${seq(b)}" (${b.id})`,
        ).toBe(false);
      }
    }
  });

  it("uses only key tokens the handler can actually produce", () => {
    /*
     * The registry is written by hand and the tokens are strings, so "G" or
     * "Esc" or "cmd+k" would sit there looking right and never match a key
     * press. Every token must be something `keyToken` can return.
     */
    const producible = new Set<string>(["mod+k", "escape", "?", "/"]);
    for (const c of "abcdefghijklmnopqrstuvwxyz") producible.add(c);

    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        expect(producible.has(k), `${s.id} wants "${k}", which no key press makes`).toBe(
          true,
        );
      }
    }
  });

  it("names a real dictionary key for every label", () => {
    for (const s of SHORTCUTS) {
      expect(
        typeof lookup(s.labelKey),
        `${s.id} has labelKey "${s.labelKey}", which is not in en.ts — it would render as humanised nonsense`,
      ).toBe("string");
    }
  });

  it("names a real dictionary key for every group title", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(typeof lookup(g.titleKey), g.titleKey).toBe("string");
    }
  });

  it("puts every shortcut in a group the sheet renders", () => {
    const groups = new Set(SHORTCUT_GROUPS.map((g) => g.key));
    for (const s of SHORTCUTS) {
      expect(
        groups.has(s.group),
        `${s.id} is in group "${s.group}", which the sheet does not list, so it is invisible`,
      ).toBe(true);
    }
  });

  it("asks only for permissions that exist", () => {
    for (const s of SHORTCUTS) {
      const perms = s.perm ? (Array.isArray(s.perm) ? s.perm : [s.perm]) : [];
      for (const p of perms) {
        expect(
          ALL_PERMISSIONS.includes(p),
          `${s.id} requires "${p}", which is not in the permission catalogue — nobody would ever be allowed it`,
        ).toBe(true);
      }
    }
  });

  it("names only real features", () => {
    for (const s of SHORTCUTS) {
      if (!s.feature) continue;
      expect(FEATURES[s.feature], `${s.id} → ${s.feature}`).toBeDefined();
    }
  });

  it("waits long enough for a second key but not for ever", () => {
    expect(SEQUENCE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(SEQUENCE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});

describe("where the shortcuts go", () => {
  /** The route tree, read the same way `nav-coverage.test.ts` reads it. */
  const appDirs = (() => {
    const appDir = join(import.meta.dirname, "..", "app", "(app)");
    return readdirSync(appDir).filter((d) =>
      statSync(join(appDir, d)).isDirectory(),
    );
  })();

  it("points every one at a page that exists", () => {
    for (const s of SHORTCUTS) {
      if (!s.href) continue;
      const top = s.href.replace(/^\//, "").split("?")[0].split("/")[0];
      expect(
        appDirs.includes(top),
        `${s.id} goes to ${s.href}, and there is no page under app/(app)/${top}`,
      ).toBe(true);
    }
  });

  it("gives every 'go' and 'do' shortcut somewhere to go", () => {
    for (const s of SHORTCUTS) {
      if (s.group === "go" || s.group === "do") {
        expect(s.href, `${s.id} is a ${s.group} shortcut with no href`).toBeTruthy();
      }
    }
  });

  it("leaves the four the provider performs itself without an href", () => {
    // These are handled in the component — a href would be a lie, and the
    // palette would offer "⌘K" as a place you can navigate to.
    for (const id of ["palette", "search-page", "sheet", "close"]) {
      expect(shortcutById(id)?.href, id).toBeUndefined();
    }
  });

  it("asks for the manage permission on anything that creates a record", () => {
    /*
     * A "do" shortcut opens a form that writes. Offering it to somebody with
     * only `.view` teaches them a key that lands on a page where the button is
     * not there, which reads as the app being broken.
     *
     * Facilities is the deliberate exception: `facilities.view` means "view
     * AND request", because the whole point of the module is that an usher can
     * ask for the hall without being able to approve it.
     */
      for (const s of SHORTCUTS.filter((x) => x.group === "do")) {
      if (s.id === "new-booking") {
        expect(s.perm).toBe("facilities.view");
        continue;
      }
      const perms = Array.isArray(s.perm) ? s.perm : [s.perm];
      expect(
        perms.every((p) => p?.endsWith(".manage")),
        `${s.id} creates something but only asks for ${perms.join("/")}`,
      ).toBe(true);
    }
  });
});

describe("reading a key press", () => {
  it("reads a plain letter", () => {
    expect(keyToken({ key: "m" })).toBe("m");
    expect(keyToken({ key: "G" })).toBe("g");
  });

  it("reads the four special keys", () => {
    expect(keyToken({ key: "Escape" })).toBe("escape");
    expect(keyToken({ key: "?" })).toBe("?");
    expect(keyToken({ key: "/" })).toBe("/");
    expect(keyToken({ key: "k", metaKey: true })).toBe("mod+k");
    expect(keyToken({ key: "k", ctrlKey: true })).toBe("mod+k");
  });

  it("leaves every other browser and system shortcut alone", () => {
    /*
     * The shortcut this app must never steal is the one somebody else's work
     * depends on. Ctrl+P prints the attendance sheet; ⌘L is the address bar;
     * Ctrl+C is a copied phone number. Swallowing any of them to save a church
     * one click would be a straight loss.
     */
    for (const key of ["p", "l", "c", "v", "t", "w", "r", "f", "s", "a"]) {
      expect(keyToken({ key, metaKey: true }), `⌘${key}`).toBeNull();
      expect(keyToken({ key, ctrlKey: true }), `Ctrl+${key}`).toBeNull();
    }
    expect(keyToken({ key: "m", altKey: true })).toBeNull();
    expect(keyToken({ key: "k", altKey: true, metaKey: true })).toBeNull();
  });

  it("ignores the keys that are not letters", () => {
    for (const key of ["Tab", "Enter", "Shift", "ArrowDown", "F5", "1", "-"]) {
      expect(keyToken({ key }), key).toBeNull();
    }
  });
});

describe("whether somebody is typing", () => {
  it("says yes for the fields people type in", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input", "textarea"]) {
      expect(isTypingTarget({ tagName }), tagName).toBe(true);
    }
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("says no for the rest of the page", () => {
    for (const tagName of ["DIV", "BODY", "BUTTON", "A", "TABLE"]) {
      expect(isTypingTarget({ tagName }), tagName).toBe(false);
    }
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("would not have eaten the M in a member's name", () => {
    /*
     * The bug this function exists for. Somebody types "Grace Mensah" into the
     * name box; the M must reach the input and not fire `n m` or start `g`.
     */
    const nameField = { tagName: "INPUT" };
    for (const ch of "Grace Mensah") {
      if (isTypingTarget(nameField)) continue;
      throw new Error(`"${ch}" would have been taken as a shortcut`);
    }
    expect(isTypingTarget(nameField)).toBe(true);
  });
});

describe("matching a sequence", () => {
  it("fires on a complete sequence", () => {
    const r = matchKeys(["g", "m"]);
    expect(r.kind).toBe("hit");
    expect(r.kind === "hit" && r.shortcut.id).toBe("go-members");
  });

  it("fires on a single-key shortcut", () => {
    expect(matchKeys(["mod+k"])).toEqual({
      kind: "hit",
      shortcut: shortcutById("palette"),
    });
    expect(matchKeys(["?"]).kind).toBe("hit");
  });

  it("waits when the buffer is the start of something", () => {
    expect(matchKeys(["g"]).kind).toBe("prefix");
    expect(matchKeys(["n"]).kind).toBe("prefix");
  });

  it("gives up when nothing can follow", () => {
    expect(matchKeys(["z"]).kind).toBe("miss");
    expect(matchKeys(["g", "z"]).kind).toBe("miss");
    expect(matchKeys([]).kind).toBe("miss");
  });

  it("keeps go and do apart", () => {
    const go = matchKeys(["g", "m"]);
    const make = matchKeys(["n", "m"]);
    expect(go.kind === "hit" && go.shortcut.href).toBe("/members");
    expect(make.kind === "hit" && make.shortcut.href).toBe("/members?new=1");
  });
});

describe("who gets taught what", () => {
  const visible = (perms: string[]) => (item: { perm?: string | string[] }) => {
    if (!item.perm) return true;
    const list = Array.isArray(item.perm) ? item.perm : [item.perm];
    return list.some((p) => perms.includes(p));
  };

  it("offers an usher only what an usher can do", () => {
    const ids = availableShortcuts(
      visible(["attendance.view", "attendance.manage"]),
    ).map((s) => s.id);

    expect(ids).toContain("go-attendance");
    expect(ids).toContain("new-attendance");
    // No permission at all, so everybody gets these.
    expect(ids).toContain("palette");
    expect(ids).toContain("sheet");
    expect(ids).toContain("go-dashboard");
    // Not theirs.
    expect(ids).not.toContain("go-members");
    expect(ids).not.toContain("new-member");
    expect(ids).not.toContain("go-settings");
  });

  it("offers everything to somebody holding every permission", () => {
    const all = availableShortcuts(visible([...ALL_PERMISSIONS]));
    expect(all).toHaveLength(SHORTCUTS.length);
  });

  it("still offers the palette and the sheet to somebody with no permissions", () => {
    const ids = availableShortcuts(visible([])).map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["palette", "search-page", "sheet", "close", "go-dashboard", "go-help"]),
    );
  });
});

describe("what the keys are called on screen", () => {
  it("says ⌘ to a Mac and Ctrl to everybody else", () => {
    expect(keyLabel("mod+k", true)).toBe("⌘K");
    expect(keyLabel("mod+k", false)).toBe("Ctrl K");
  });

  it("writes a letter as a capital", () => {
    expect(keyLabel("m", false)).toBe("M");
  });

  it("writes Escape the way it is printed on the key", () => {
    expect(keyLabel("escape", false)).toBe("Esc");
  });

  it("joins a sequence into something readable", () => {
    expect(keysLabel(["g", "m"], false)).toBe("G then M");
    expect(keysLabel(["mod+k"], true)).toBe("⌘K");
  });

  it("takes the word for 'then' from the caller, so it can be translated", () => {
    expect(keysLabel(["g", "m"], false, "sannan")).toBe("G sannan M");
  });
});

/* ------------------------------------------------------------------ *
 * What the cheat sheet would actually show
 * ------------------------------------------------------------------ */

/**
 * The real gate, not a stand-in.
 *
 * The block above tests `availableShortcuts` against a hand-written `visible`,
 * which proves the filter works but not that the app wires it to the right
 * question. This runs the genuine `navVisible` — the same function the sidebar
 * uses, against the live pilot map — because the failure worth catching is a
 * sheet that promises a key for a module the menu is hiding, and that failure
 * lives in the wiring rather than in the filter.
 *
 * It is the same idea as `whatTheSidebarShows` in `nav-coverage.test.ts`, and
 * for the same reason: three modules once shipped invisible because everything
 * downstream of the broken thing passed.
 */
function whatTheSheetShows(
  perms: string[],
  isOwner: boolean,
  churchSlug: string | null,
): string[] {
  return availableShortcuts((item) =>
    navVisible(item, perms, isOwner, churchSlug),
  ).map((s) => s.id);
}

describe("what an owner's cheat sheet shows", () => {
  const shown = whatTheSheetShows([], true, "any-church");

  it("shows every shortcut in the registry", () => {
    expect(shown).toHaveLength(SHORTCUTS.length);
  });

  it("shows the keys for the three modules that once shipped invisible", () => {
    for (const id of ["go-facilities", "new-booking", "go-first-timers", "new-first-timer"]) {
      expect(
        shown.includes(id),
        `${id} does not survive the real nav gate, so the sheet would promise a key that is hidden from the menu`,
      ).toBe(true);
    }
  });

  it("fills every group the sheet renders, so none is empty", () => {
    for (const g of SHORTCUT_GROUPS) {
      const inGroup = SHORTCUTS.filter(
        (s) => s.group === g.key && shown.includes(s.id),
      );
      expect(inGroup.length, `group "${g.key}" is empty for an owner`).toBeGreaterThan(0);
    }
  });
});

describe("what a limited team member's cheat sheet shows", () => {
  it("shows the facilities keys to somebody with facilities.view alone", () => {
    const shown = whatTheSheetShows(["facilities.view"], false, "any-church");
    expect(shown).toContain("go-facilities");
    // `.view` means view AND request in this module, so the booking key is
    // theirs too — the whole point is that an usher can ask for the hall.
    expect(shown).toContain("new-booking");
  });

  it("hides them from somebody without that permission", () => {
    const shown = whatTheSheetShows(["members.view"], false, "any-church");
    expect(shown).not.toContain("go-facilities");
    expect(shown).not.toContain("new-booking");
    expect(shown).toContain("go-members");
  });

  it("offers Members to a viewer but not the key that adds one", () => {
    // Teaching `n m` to somebody who cannot add a member sends them to a page
    // where the button is not there, which reads as the app being broken.
    const shown = whatTheSheetShows(["members.view"], false, "any-church");
    expect(shown).toContain("go-members");
    expect(shown).not.toContain("new-member");
  });

  it("still gives somebody with no permissions a way to search and get help", () => {
    const shown = whatTheSheetShows([], false, null);
    expect(shown).toEqual(
      expect.arrayContaining(["palette", "sheet", "close", "go-dashboard", "go-help"]),
    );
  });
});
