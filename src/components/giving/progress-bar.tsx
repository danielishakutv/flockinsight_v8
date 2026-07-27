import { cn } from "@/lib/utils";

/**
 * A raised-vs-target progress bar. With no target it stays a subtle full track
 * (open-ended collection); at/over target it turns success-green.
 */
export function ProgressBar({
  value,
  target,
  currency,
  showPct = true,
}: {
  value: number;
  target: number | null;
  currency: string;
  showPct?: boolean;
}) {
  const pct =
    target && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : null;
  const over = target != null && target > 0 && value >= target;
  void currency;

  return (
    <div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            over ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${pct ?? (value > 0 ? 100 : 0)}%` }}
        />
      </div>
      {showPct && pct != null && (
        <p className="text-muted-foreground mt-1 text-right text-xs tabular-nums">
          {pct}%
        </p>
      )}
    </div>
  );
}
