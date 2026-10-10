"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useStoredValue, writeStoredValue } from "@/lib/client-state";
import { visibleNavItems, type MenuItem } from "@/lib/nav";
import { parseStored } from "@/lib/nav-state";
import {
  PINS_KEY,
  VISITS_KEY,
  destinationFor,
  forget,
  rankQuickAccess,
  recordVisit,
  referencePoint,
  togglePin,
  type QuickItem,
  type VisitLog,
} from "@/lib/nav-prefs";

/**
 * The browser side of Quick access: one component that counts, one hook that
 * reads.
 *
 * The rules are all in `lib/nav-prefs.ts` and tested there. What is here is
 * only the two things that need a browser — knowing which page we are on, and
 * writing to storage — kept apart from the rules on purpose, because the rules
 * are the part worth arguing with.
 */

type Access = { perms: string[]; isOwner: boolean; churchSlug: string | null };

function useVisibleItems({ perms, isOwner, churchSlug }: Access): MenuItem[] {
  return useMemo(
    () => visibleNavItems(perms, isOwner, churchSlug),
    [perms, isOwner, churchSlug],
  );
}

/* ================================================================== *
 * Counting
 * ================================================================== */

/**
 * Records that this person opened this page. Renders nothing.
 *
 * In the app shell rather than inside the sidebar, deliberately. The sidebar
 * is `hidden lg:flex`, so it does mount on a phone and counting from inside it
 * would work today — but it would work by accident, and the day somebody makes
 * the sidebar desktop-only, every phone in every church silently stops
 * learning anything and nobody finds out, because an empty Quick access looks
 * exactly like a new user.
 */
export function NavVisitRecorder({ perms, isOwner, churchSlug }: Access) {
  const pathname = usePathname();
  const items = useVisibleItems({ perms, isOwner, churchSlug });
  const hrefs = useMemo(() => items.map((i) => i.href), [items]);

  /*
   * Once per arrival, not once per render.
   *
   * React may mount an effect twice in development, and a page that re-renders
   * for its own reasons must not count as a second visit — otherwise a page
   * that polls outranks one somebody chose to open.
   */
  const counted = useRef<string | null>(null);

  useEffect(() => {
    const href = destinationFor(pathname, hrefs);
    if (!href) return; // a page that is not a menu entry: nothing to learn
    if (counted.current === href) return;
    counted.current = href;

    const raw = readStored(VISITS_KEY);
    const log = parseStored<VisitLog>(raw, {});
    writeStoredValue(
      VISITS_KEY,
      JSON.stringify(recordVisit(log, href, Date.now())),
    );
  }, [pathname, hrefs]);

  return null;
}

/**
 * A one-off read, for the write path only.
 *
 * `useStoredValue` is the right way to READ reactively, but a writer needs the
 * value at the instant it writes, and subscribing a component to the key it is
 * about to change would make it re-render itself for its own write.
 *
 * Failure here is not silent: a blocked store means Quick access never learns
 * anything, which is a real (if small) loss of function, so it says so once
 * rather than returning a quiet null for ever.
 */
let warnedAboutStorage = false;
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn(
        `[nav] This browser will not let the app store "${key}" (private mode, ` +
          `or site data blocked). Quick access will stay empty and pins will ` +
          `not be remembered; the rest of the menu is unaffected.`,
        err,
      );
    }
    return null;
  }
}

/* ================================================================== *
 * Reading
 * ================================================================== */

export type QuickAccessRow = QuickItem & { item: MenuItem };

export type QuickAccess = {
  rows: QuickAccessRow[];
  /** Is this destination pinned? For the pin button on every menu row. */
  isPinned: (href: string) => boolean;
  /** Pin or unpin. Pinning a destination we guessed at makes it permanent. */
  toggle: (href: string) => void;
  /** Drop a guess and forget the visits behind it, so it does not return. */
  dismiss: (href: string) => void;
};

/**
 * What to show at the top of the menu, and the two ways to change it.
 *
 * Both halves are read through `useStoredValue`, so they are null on the
 * server and during hydration — Quick access is simply absent in the markup
 * and appears on the first client render. That is the honest shape of the
 * thing: it is a fact about this browser, and there is nothing the server
 * could have rendered that would not have been a guess it then had to correct.
 */
export function useQuickAccess({
  perms,
  isOwner,
  churchSlug,
}: Access): QuickAccess {
  const items = useVisibleItems({ perms, isOwner, churchSlug });

  const visitsRaw = useStoredValue(VISITS_KEY);
  const pinsRaw = useStoredValue(PINS_KEY);
  const log = useMemo(() => parseStored<VisitLog>(visitsRaw, {}), [visitsRaw]);
  const pins = useMemo(() => parseStored<string[]>(pinsRaw, []), [pinsRaw]);

  const rows = useMemo(() => {
    const byHref = new Map(items.map((i) => [i.href, i]));
    return rankQuickAccess({
      log,
      pins,
      hrefs: items.map((i) => i.href),
      /*
       * The newest visit in the log, not the clock. A reference point factors
       * out of the score as a common multiplier and so cannot change the
       * order — see `referencePoint` — which is what lets this whole hook be a
       * pure function of what is stored, rather than something that quietly
       * returns a different answer each time React re-renders it.
       */
      now: referencePoint(log),
    })
      .map((r) => {
        const item = byHref.get(r.href);
        return item ? { ...r, item } : null;
      })
      .filter((r): r is QuickAccessRow => r !== null);
  }, [items, log, pins]);

  return {
    rows,
    isPinned: (href) => pins.includes(href),
    toggle: (href) =>
      writeStoredValue(PINS_KEY, JSON.stringify(togglePin(pins, href))),
    /*
     * Dismissing clears the visits as well as the row. Hiding it without
     * forgetting would put it straight back inside a week, and an app that
     * keeps re-suggesting something somebody has told it to drop has stopped
     * being theirs.
     */
    dismiss: (href) =>
      writeStoredValue(VISITS_KEY, JSON.stringify(forget(log, href))),
  };
}
