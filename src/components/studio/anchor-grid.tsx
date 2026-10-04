"use client";

import { ANCHORS, type Anchor } from "@/lib/image-studio";
import { cn } from "@/lib/utils";

/**
 * The nine places a logo can go, as a nine-button grid.
 *
 * A grid rather than a dropdown because position is spatial: "bottom right" in
 * a list of nine words takes a moment to read, and the same thing as a square
 * in the corner of a square takes none. It is also the only version that works
 * with a thumb.
 */
export function AnchorGrid({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: Anchor;
  onChange: (anchor: Anchor) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase">
        {label}
      </p>
      <div
        role="radiogroup"
        aria-label={label}
        className="bg-muted/50 grid w-[132px] grid-cols-3 gap-1 rounded-xl border p-1"
      >
        {ANCHORS.map((anchor) => {
          const active = anchor === value;
          return (
            <button
              key={anchor}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={anchor.replace("-", " ")}
              disabled={disabled}
              onClick={() => onChange(anchor)}
              className={cn(
                // 40px cells: the grid is 132px wide in total, which is about
                // as small as nine separate touch targets can honestly be.
                "grid size-10 place-items-center rounded-lg transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-background text-muted-foreground",
                disabled && "opacity-50",
              )}
            >
              <span
                className={cn(
                  "block rounded-sm",
                  active ? "bg-primary-foreground size-2.5" : "bg-current size-1.5",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
