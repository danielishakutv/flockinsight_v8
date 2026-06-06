"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stepper({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 1_000_000,
  step = 1,
  accent,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  accent?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const set = (n: number) => onChange(clamp(Number.isFinite(n) ? n : min));

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border p-3 sm:p-4",
        accent ? "border-primary/30 bg-primary/5" : "bg-card",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-base font-bold sm:text-lg">{label}</div>
        {hint && (
          <div className="text-muted-foreground truncate text-xs">{hint}</div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => set(value - step)}
          disabled={value <= min}
          className="grid size-12 shrink-0 place-items-center rounded-full border bg-background text-foreground shadow-sm transition active:scale-90 disabled:opacity-40 sm:size-14"
        >
          <Minus className="size-5" strokeWidth={3} />
        </button>

        <input
          type="number"
          inputMode="numeric"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          onChange={(e) => set(parseInt(e.target.value, 10))}
          onFocus={(e) => e.target.select()}
          className="w-16 bg-transparent text-center text-3xl font-extrabold tabular-nums outline-none sm:w-20 sm:text-4xl"
        />

        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => set(value + step)}
          disabled={value >= max}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition active:scale-90 disabled:opacity-40 sm:size-14"
        >
          <Plus className="size-5" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
