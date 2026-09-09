import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  delta,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  delta?: number | null;
  accent?: boolean;
}) {
  const hasDelta = delta !== null && delta !== undefined;
  const up = (delta ?? 0) >= 0;

  return (
    <Card
      className={cn(
        "gap-0 p-5",
        accent && "from-primary to-violet-500 bg-gradient-to-br text-white",
      )}
    >
      {/*
        The label WRAPS, it does not truncate.
        Four of these across a laptop leaves each card narrow enough that
        "Total members" and "Weekly average" were being cut to "Total mem…" —
        which reads as a broken layout rather than a deliberate one, and hides
        the one word that says what the number is. Two short lines cost a few
        pixels of height and always say the whole thing. `min-h` keeps a
        one-line card the same height as a two-line one so the row stays even.
      */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "min-w-0 min-h-[2.5rem] text-sm leading-tight font-semibold text-balance",
            accent ? "text-white/80" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            accent ? "bg-white/20" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>

      <div className="mt-3 flex w-full flex-wrap items-end gap-2">
        <span className="min-w-0 max-w-full text-3xl font-extrabold tabular-nums leading-none break-words sm:text-4xl">
          {value}
        </span>
        {hasDelta && (
          <span
            // A fall is information, not an error. The destructive red is the
            // colour used for "you are about to delete something", and against
            // a dark card it pulled the eye before the number it describes.
            // Amber reads as "worth a look" without shouting.
            className={cn(
              "mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold",
              accent
                ? "bg-white/20 text-white"
                : up
                  ? "bg-success/15 text-success"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            )}
          >
            {up ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownRight className="size-3.5" />
            )}
            {Math.abs(delta!)}%
          </span>
        )}
      </div>

      {sub && (
        <p
          className={cn(
            "mt-1 text-xs",
            accent ? "text-white/70" : "text-muted-foreground",
          )}
        >
          {sub}
        </p>
      )}
    </Card>
  );
}
