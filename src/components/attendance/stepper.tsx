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
        "flex flex-col gap-2 rounded-2xl border p-3 text-center",
        accent ? "border-primary/30 bg-primary/5" : "bg-card",
      )}
    >
      <div className="min-h-7">
        <div className="truncate text-sm font-bold">{label}</div>
        {hint && (
          <div className="text-muted-foreground text-[10px] leading-tight">
            {hint}
          </div>
        )}
      </div>

      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => set(value - step)}
          disabled={value <= min}
          className="bg-background grid size-10 shrink-0 place-items-center rounded-full border shadow-sm transition active:scale-90 disabled:opacity-40"
        >
          <Minus className="size-4" strokeWidth={3} />
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
          className="w-0 min-w-0 flex-1 bg-transparent text-center text-2xl font-extrabold tabular-nums outline-none sm:text-3xl"
        />

        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => set(value + step)}
          disabled={value >= max}
          className="bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-full shadow-sm transition active:scale-90 disabled:opacity-40"
        >
          <Plus className="size-4" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
