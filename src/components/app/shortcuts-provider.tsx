"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { navVisible } from "@/lib/nav";
import {
  SEQUENCE_TIMEOUT_MS,
  availableShortcuts,
  isTypingTarget,
  keyToken,
  matchKeys,
  type Shortcut,
} from "@/lib/shortcuts";
import { markLearned } from "@/lib/shortcut-tips";
import { useTipState } from "@/lib/use-shortcut-tips";
import { CommandPalette } from "@/components/app/command-palette";
import { ShortcutSheet } from "@/components/app/shortcut-sheet";
import { ShortcutTip } from "@/components/app/shortcut-tip";

/** Asks the provider to open the palette. See `PaletteHint`. */
export const OPEN_PALETTE_EVENT = "fi:open-palette";

/** Opens the ⌘K palette from anywhere, without pretending to be a key press. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

/**
 * Every keystroke in the app passes through here.
 *
 * Which is the reason this file is mostly about what NOT to do. The matching
 * itself is in `lib/shortcuts.ts` and tested there; what is left is the three
 * ways a global key handler ruins somebody's afternoon:
 *
 *  1. **Eating a letter they were typing.** Somebody writes "Grace Mensah"
 *     into a name field and the M navigates away with the half-filled form.
 *     `isTypingTarget` is the guard, and it errs towards "they are typing".
 *  2. **Navigating out of an open form.** The dialog is not a text field, so
 *     guard 1 does not cover a stray `g` while the Add member sheet is open
 *     with six fields filled in. Nothing navigates while a dialog is open.
 *  3. **Stealing the browser's own keys.** ⌘P prints the attendance sheet, ⌘L
 *     is the address bar. `keyToken` claims exactly one chord, ⌘K, and returns
 *     null for every other modifier combination.
 *
 * It renders the three surfaces that go with the keys — the palette, the cheat
 * sheet and the occasional tip — because all three need the same
 * permission-filtered list, and building it once here means the sheet can
 * never promise a key the handler would refuse.
 */
export function ShortcutsProvider({
  perms = [],
  isOwner = false,
  churchSlug = null,
  plan = "starter",
}: {
  perms?: string[];
  isOwner?: boolean;
  churchSlug?: string | null;
  plan?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { update: updateTips } = useTipState();

  /*
   * The same two questions the sidebar asks, answered by the same function.
   *
   * This is the whole reason `navVisible` is passed in rather than
   * re-implemented: a shortcut must be offered on exactly the terms the menu
   * uses, or the cheat sheet starts promising keys to modules the menu is
   * hiding. One source of truth, as with the nav itself.
   */
  const available = useMemo(
    () =>
      availableShortcuts((item) =>
        navVisible(item, perms, isOwner, churchSlug),
      ),
    [perms, isOwner, churchSlug],
  );

  /* ---------------------------------------------------------------- *
   * Performing one
   * ---------------------------------------------------------------- */

  const perform = useCallback(
    (s: Shortcut) => {
      /*
       * Remember it, so the tip for it never appears again.
       *
       * Written before acting rather than after: `router.push` can unmount
       * this subtree on a page that redirects, and a shortcut somebody has
       * demonstrably used being taught to them next week is the one outcome
       * this whole feature exists to avoid.
       */
      updateTips((prev) => markLearned(prev, s.id));

      switch (s.id) {
        case "palette":
          setSheetOpen(false);
          setPaletteOpen((v) => !v);
          return;
        case "sheet":
          setPaletteOpen(false);
          setSheetOpen((v) => !v);
          return;
        case "close":
          setPaletteOpen(false);
          setSheetOpen(false);
          return;
        case "search-page":
          focusPageSearch();
          return;
        default:
          if (s.href) {
            setPaletteOpen(false);
            setSheetOpen(false);
            router.push(s.href);
          }
      }
    },
    [router, updateTips],
  );

  /* ---------------------------------------------------------------- *
   * Listening
   * ---------------------------------------------------------------- */

  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * What the listener needs to know, kept current without re-subscribing.
   *
   * The `keydown` listener below is attached once, with no dependencies, on
   * purpose: a listener that tears down and re-attaches on every render is how
   * a half-typed `g` gets lost between the two keys. So everything it reads
   * goes through this one ref.
   *
   * Assigned in an effect rather than during render — a ref mutated while
   * rendering is a lint error in this project and a genuine hazard besides,
   * since a render React discards would still have changed it. The effect has
   * no dependency array, so it runs after every commit, which is exactly when
   * "the latest" becomes true.
   */
  const latestRef = useRef({
    perform,
    available,
    open: { palette: false, sheet: false },
  });
  useEffect(() => {
    latestRef.current = {
      perform,
      available,
      open: { palette: paletteOpen, sheet: sheetOpen },
    };
  });

  useEffect(() => {
    function clearBuffer() {
      bufferRef.current = [];
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      const token = keyToken(e);
      if (token === null) return;

      /*
       * Guard 1: they are typing, so the keys belong to the field.
       *
       * Two exceptions, and both are the difference between a shortcut and a
       * trap. Escape must always close, or a form becomes one you cannot get
       * out of. And ⌘K is a chord, not a character — nobody types it into a
       * name box — so it still toggles the palette when the cursor is already
       * in the palette's own search box, which is where it is a moment after
       * the palette opens.
       *
       * `?` is NOT an exception, deliberately: in a search box it is a
       * character somebody meant to type.
       */
      const typing = isTypingTarget(e.target as HTMLElement | null);
      if (typing && token !== "escape" && token !== "mod+k") {
        clearBuffer();
        return;
      }

      const list = latestRef.current.available;

      /*
       * Guard 2: a dialog is open.
       *
       * Checked against the DOM rather than our own state, so it covers every
       * dialog in the app — Add member, Record giving, the delete
       * confirmations — and not only the two this component owns. A stray `g`
       * must not navigate away from a form with six fields filled in.
       *
       * The palette and the sheet are dialogs too, so the keys that work them
       * are allowed through: ⌘K toggles the palette, `?` the sheet, Escape
       * closes either.
       */
      const ours = latestRef.current.open.palette || latestRef.current.open.sheet;
      const dialogOpen = ours || hasOpenDialog();
      if (dialogOpen) {
        if (token === "escape") {
          // Let the dialog's own Escape handling run; only close ours.
          if (ours) latestRef.current.perform(find(list, "close"));
          return;
        }
        if (token === "mod+k") {
          e.preventDefault();
          latestRef.current.perform(find(list, "palette"));
          return;
        }
        if (token === "?" && ours && !typing) {
          e.preventDefault();
          latestRef.current.perform(find(list, "sheet"));
          return;
        }
        clearBuffer();
        return;
      }

      const next = [...bufferRef.current, token];
      const result = matchKeys(next, list);

      if (result.kind === "hit") {
        e.preventDefault();
        clearBuffer();
        latestRef.current.perform(result.shortcut);
        return;
      }

      if (result.kind === "prefix") {
        /*
         * `g` on its own does nothing visible, and is deliberately NOT
         * prevented: if the second key never comes, whatever `g` would have
         * done on the page still happens a moment later, rather than being
         * silently swallowed by a shortcut that never completed.
         */
        bufferRef.current = next;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(clearBuffer, SEQUENCE_TIMEOUT_MS);
        return;
      }

      clearBuffer();
    }

    /*
     * The button in the top bar, which is how most people will find any of
     * this at all.
     *
     * A real event rather than a synthetic key press. Dispatching a fake
     * `keydown` would work — it is what the superadmin palette does — but it
     * means a click arrives disguised as something it is not, and anything
     * else listening for keys sees a press that never happened.
     */
    function onOpenRequest() {
      latestRef.current.perform(find(latestRef.current.available, "palette"));
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        perms={perms}
        isOwner={isOwner}
        churchSlug={churchSlug}
        plan={plan}
        available={available}
        onPerform={perform}
        onOpenSheet={() => {
          setPaletteOpen(false);
          setSheetOpen(true);
        }}
      />
      <ShortcutSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        available={available}
      />
      <ShortcutTip
        pathname={pathname}
        available={available}
        onOpenSheet={() => setSheetOpen(true)}
      />
    </>
  );
}

/**
 * A Shortcut by id, or a stand-in.
 *
 * The four the provider performs itself have no permission, so they are always
 * in the list — but reading `[0]` off a `find` is how a tiny refactor becomes a
 * crash in the app shell, so the fallback carries the id and the switch in
 * `perform` still does the right thing.
 */
function find(list: readonly Shortcut[], id: string): Shortcut {
  return (
    list.find((s) => s.id === id) ??
    ({ id, keys: [], labelKey: "shortcuts.title", group: "help" } as Shortcut)
  );
}

/** Any Radix dialog, sheet or alert currently on screen. */
function hasOpenDialog(): boolean {
  return document.querySelector("[role='dialog'], [role='alertdialog']") !== null;
}

/**
 * `/` — put the cursor in the page's own search box.
 *
 * Marked with `data-page-search` on the primary search box of each list, and
 * found by that attribute alone.
 *
 * The first version of this also matched `input[placeholder*="search" i]` as a
 * fallback, which worked beautifully in English and nowhere else: this app
 * ships in eight languages, and a church reading it in Hausa has a placeholder
 * reading "Nemo…". A selector that only works in the default locale is the
 * kind of bug that never shows up where it is written. The attribute is the
 * contract; `input[type="search"]` stays because it is a real type and not a
 * piece of English.
 */
function focusPageSearch(): void {
  const el = document.querySelector<HTMLInputElement>(
    "[data-page-search], input[type='search']",
  );
  if (!el) return;
  el.focus();
  el.select();
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}
