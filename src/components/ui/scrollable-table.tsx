"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A table that can be read on a phone.
 *
 * The app shell clips horizontal overflow (`overflow-x-clip` on `main`), which
 * is what stops the whole page sliding around under a thumb. The cost is that
 * anything wider than the screen is not merely off-screen but unreachable — so
 * every wide table needs its own scroller inside that clip. This is it, in one
 * place, so a new table gets it by default rather than by remembering.
 *
 * Three things beyond `overflow-x-auto`:
 *
 *   - A fade at whichever edge has more content behind it. Without it there is
 *     nothing on screen to say the table continues, and people simply do not
 *     find the last columns. It appears only when there is something to reveal.
 *   - An optional sticky first column, so the row is still identifiable once
 *     you have scrolled the name off the left.
 *   - `tabIndex` when it actually scrolls, so a keyboard can reach it. A
 *     focusable element that does not scroll is a pointless tab stop, so it is
 *     added and removed with the need.
 *
 * Desktop is untouched: at a width where the table fits, nothing here renders
 * anything visible.
 */
export function ScrollableTable({
  children,
  stickyFirstColumn = false,
  className,
  label,
  hint,
}: {
  children: React.ReactNode;
  /**
   * Freeze the first column. Right for a table whose first cell names the row
   * (a person, an account, a date); wrong where the first column is a checkbox
   * or an index, which is not worth the horizontal room.
   */
  stickyFirstColumn?: boolean;
  className?: string;
  /** Describes the table to a screen reader once the region is focusable. */
  label?: string;
  /**
   * The one-line nudge shown on phones.
   *
   * A prop rather than a `useT()` call inside: this is a `ui/` primitive, and
   * it is used on the platform-admin and public report pages, which sit outside
   * the app shell and have no translation provider above them. Taking the
   * string in keeps the primitive usable anywhere, and callers inside the app
   * pass `t("common.scrollForMore")`.
   */
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A couple of pixels of slack: fractional layout widths mean scrollWidth
    // and clientWidth are rarely exactly equal even when nothing overflows.
    const canScroll = el.scrollWidth - el.clientWidth > 2;
    setScrollable(canScroll);
    setEdges({
      left: canScroll && el.scrollLeft > 2,
      right: canScroll && el.scrollLeft < el.scrollWidth - el.clientWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    // The table's own width changes when data loads, a column is toggled, or
    // the window is resized — a resize listener alone would miss the first two.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        onScroll={measure}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? label : undefined}
        tabIndex={scrollable ? 0 : undefined}
        className={cn(
          "overflow-x-auto overscroll-x-contain",
          // A visible ring when a keyboard focuses the scroller, so it is clear
          // what the arrow keys are about to move.
          "focus-visible:ring-ring/50 rounded-lg focus-visible:ring-2 focus-visible:outline-none",
          stickyFirstColumn &&
            "[&_td:first-child]:bg-card [&_th:first-child]:bg-card [&_td:first-child]:sticky [&_th:first-child]:sticky [&_td:first-child]:left-0 [&_th:first-child]:left-0 [&_td:first-child]:z-10 [&_th:first-child]:z-20",
        )}
      >
        {children}
      </div>

      {/*
        Fades, not scrollbars. `pointer-events-none` so they never swallow a tap
        aimed at the row underneath, and `aria-hidden` because they say nothing
        a screen reader needs — the region role already announces the scroll.
      */}
      <div
        aria-hidden
        className={cn(
          "from-background pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r to-transparent transition-opacity duration-200",
          edges.left ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "from-background pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent transition-opacity duration-200",
          edges.right ? "opacity-100" : "opacity-0",
        )}
      />

      {/*
        One line of text, on phones only, the first time it matters. A fade
        alone reads as decoration to a lot of people; the words remove the
        guess. It goes away as soon as they scroll.
      */}
      {scrollable && edges.right && !edges.left && (
        <p
          aria-hidden
          className="text-muted-foreground mt-1.5 text-center text-[11px] sm:hidden"
        >
          {hint ?? "Scroll sideways for more"} →
        </p>
      )}
    </div>
  );
}
