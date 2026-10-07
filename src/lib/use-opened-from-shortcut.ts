"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * `?new=1` — the convention behind every "do" shortcut.
 *
 * `n m` and the palette's "Add a member" both do exactly one thing: go to
 * `/members?new=1`. The page reads it with this hook and opens its form. One
 * code path for the key press, the palette row and a bookmark, instead of a
 * global event bus with a handler per module.
 *
 * It then takes the parameter back out of the address bar, for two reasons
 * that are both real bugs without it:
 *
 *  - a refresh after saving would open the empty form again;
 *  - pressing `n m` while already sitting on `/members?new=1` would not be a
 *    navigation at all — same URL — so the form would never reopen.
 *
 * `router.replace` with `scroll: false`, so it does not touch the history
 * stack and Back still goes where the person came from.
 *
 * Returns a COUNT, not a flag. A flag cannot say "asked again": somebody who
 * presses `n m`, closes the form without saving, and presses `n m` again is
 * asking for the same thing twice, and the second ask has to be distinguishable
 * from the first.
 */
export function useOpenRequestCount(param = "new"): number {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [count, setCount] = useState(0);

  /*
   * Guards against counting one arrival twice. The effect re-runs when
   * `router.replace` below changes the params, and the ref is what keeps that
   * second run from reading as a fresh request.
   */
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (params.get(param) !== "1") {
      // Cleared, so the next `?new=1` is a new request even if the URL
      // string happens to match the last one handled.
      handledRef.current = null;
      return;
    }

    const token = `${pathname}?${params.toString()}`;
    if (handledRef.current === token) return;
    handledRef.current = token;

    setCount((n) => n + 1);

    const next = new URLSearchParams(params.toString());
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, param, pathname, router]);

  return count;
}

/**
 * The same thing for a component that owns its own `open` state.
 *
 * Most of the forms this reaches already have `const [open, setOpen] =
 * useState(false)`, and the useful shape there is "tell me when to open", not
 * a second flag to reconcile with the first.
 */
export function useOpenOnShortcut(onOpen: () => void, param = "new"): void {
  const count = useOpenRequestCount(param);

  /*
   * The newest callback, so an inline arrow does not re-fire this on every
   * render — the effect below depends on the count alone.
   *
   * Assigned in an effect, not during render: a ref mutated while rendering is
   * a lint error in this project, and a render React throws away would still
   * have changed it.
   */
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    if (count === 0) return;
    onOpenRef.current();
  }, [count]);
}
