"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Stepper } from "@/components/attendance/stepper";
import { cn } from "@/lib/utils";

/**
 * One counted group, collapsed to a single tappable row.
 *
 * A church that counts five bands plus first-timers and new converts has
 * fourteen steppers on this form. Stacked open, Save is three screens down and
 * the groups somebody actually has numbers for are lost among the ones they
 * leave at zero. So each group collapses to a row that still shows its own
 * subtotal and its male/female split — nothing is hidden by being closed,
 * only the controls are — and one tap anywhere on the row opens it.
 *
 * The closed panel is `inert` so its steppers are out of the tab order too; a
 * row that looks closed must not be reachable by keyboard, or the count can be
 * changed by somebody who cannot see what they are changing.
 */
export function CountGroup({
  id,
  title,
  subtitle,
  male,
  female,
  onMale,
  onFemale,
  open,
  onToggle,
  note,
  carried = 0,
  muted,
}: {
  id: string;
  title: string;
  /** Who this group holds, or why it is not added to the total. */
  subtitle?: string;
  male: number;
  female: number;
  onMale: (n: number) => void;
  onFemale: (n: number) => void;
  open: boolean;
  onToggle: () => void;
  /** A one-off explanation, e.g. a legacy count with no gender split. */
  note?: string;
  /**
   * A count recorded before the gender split existed. It is still in the
   * total, so the row must show it — a collapsed row reading 0 beside a total
   * that includes those people is the form contradicting itself.
   */
  carried?: number;
  /** First-timers and new converts: counted, but already inside the total. */
  muted?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const split = male + female;
  const total = split > 0 ? split : carried;

  /*
   * Bring a freshly opened group into view. `block: "nearest"` scrolls the
   * minimum needed, so a group that already fits on screen does not move —
   * the jumpiness that makes accordions feel unstable.
   */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(
      () => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      320,
    );
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        open
          ? "border-primary/40 bg-primary/5"
          : total > 0 && !muted
            ? "border-primary/25 bg-card"
            : "bg-card",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="hover:bg-primary/5 flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{title}</div>
          <div className="text-muted-foreground truncate text-xs leading-tight">
            {split > 0
              ? `${male} male · ${female} female`
              : carried > 0
                ? "recorded without a gender split"
                : (subtitle ?? "Tap to count")}
          </div>
        </div>

        <span
          className={cn(
            "text-2xl font-extrabold tabular-nums",
            total > 0 ? (muted ? "text-foreground" : "text-primary") : "text-muted-foreground/40",
          )}
        >
          {total}
        </span>

        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground size-5 shrink-0 transition-transform duration-300 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={`${id}-panel`}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 px-3 pb-3">
            <div className="grid grid-cols-2 gap-3">
              <Stepper label="Male" value={male} onChange={onMale} accent />
              <Stepper label="Female" value={female} onChange={onFemale} accent />
            </div>
            {note && <p className="text-muted-foreground px-1 text-xs">{note}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
