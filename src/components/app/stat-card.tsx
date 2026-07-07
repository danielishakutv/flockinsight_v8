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
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "min-w-0 truncate text-sm font-semibold",
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
            className={cn(
              "mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold",
              accent
                ? "bg-white/20 text-white"
                : up
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive",
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
