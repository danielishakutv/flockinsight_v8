"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** The attribute that opts a `<details>` menu into being dismissed. */
export const DISMISSABLE = "data-dismissable";

/**
 * Closes the header's `<details>` menus the way every other menu closes.
 *
 * A native `<details>` only closes when its own summary is clicked again. So a
 * dropdown stayed open over the page after a click anywhere else, after Escape,
 * and — because Next keeps the header mounted between pages — even after a
 * link inside it had taken you somewhere new. People read that as broken.
 *
 * The menus themselves stay plain HTML (see the note in public-header.tsx):
 * they still open and work with no JavaScript at all. This only adds the
 * closing, and renders nothing.
 */
export function MenuDismiss() {
  const pathname = usePathname();

  // A new page: nothing should still be hanging open from the last one.
  useEffect(() => {
    closeAll();
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      /*
       * The language picker inside the phone menu is a Radix menu, and its
       * list is portalled to <body> — outside the <details> in the DOM though
       * visually inside it. A tap there is a choice, not a click away.
       */
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]"))
        return;
      for (const d of openMenus()) {
        if (!target || !d.contains(target)) d.open = false;
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const open = openMenus();
      if (open.length === 0) return;
      open.forEach((d) => (d.open = false));
      // Back to the button that opened it, so the keyboard user is not lost.
      open[0]?.querySelector("summary")?.focus();
    }
    function onClick(e: MouseEvent) {
      // A link inside a menu was followed: the menu has done its job. Covers
      // a link to the page you are already on, where the pathname never moves.
      const link = (e.target as Element | null)?.closest?.("a[href]");
      const menu = link?.closest(`details[${DISMISSABLE}]`);
      if (menu instanceof HTMLDetailsElement) menu.open = false;
    }
    function onToggle(e: Event) {
      // One open at a time: opening "Compare" closes "Features".
      const opened = e.target;
      if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
      if (!opened.hasAttribute(DISMISSABLE)) return;
      for (const d of openMenus()) if (d !== opened && !d.contains(opened)) d.open = false;
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    // `toggle` does not bubble; capture sees it on the way down.
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);

  return null;
}

function openMenus(): HTMLDetailsElement[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>(`details[${DISMISSABLE}][open]`));
}

function closeAll() {
  openMenus().forEach((d) => (d.open = false));
}
