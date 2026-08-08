import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single list of everything wanting the operator's attention, ranked by
 * severity. Replaces three hardcoded amber cards that only knew about sender
 * IDs, tickets and suspensions.
 */

export type QueueSeverity = "critical" | "warning" | "info";

export type QueueItem = {
  key: string;
  severity: QueueSeverity;
  message: string;
  href: string;
};

const STYLE: Record<
  QueueSeverity,
  { icon: LucideIcon; wrap: string; chip: string; label: string }
> = {
  critical: {
    icon: ShieldAlert,
    wrap: "border-destructive/30 bg-destructive/5 hover:bg-destructive/10",
    chip: "bg-destructive/15 text-destructive",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Warning",
  },
  info: {
    icon: Info,
    wrap: "hover:bg-accent",
    chip: "bg-primary/10 text-primary",
    label: "To do",
  },
};

export function StatusLine({ items }: { items: QueueItem[] }) {
  const critical = items.filter((i) => i.severity === "critical").length;
  const total = items.length;

  if (total === 0) {
    return (
      <div className="text-success bg-success/10 border-success/20 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold">
        <CheckCircle2 className="size-5 shrink-0" />
        All systems normal
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold",
        critical > 0
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      )}
    >
      {critical > 0 ? (
        <ShieldAlert className="size-5 shrink-0" />
      ) : (
        <AlertTriangle className="size-5 shrink-0" />
      )}
      {critical > 0
        ? `${critical} critical issue${critical === 1 ? "" : "s"} — ${total} thing${total === 1 ? "" : "s"} need you`
        : `${total} thing${total === 1 ? "" : "s"} need you`}
    </div>
  );
}

export function ActionQueue({ items }: { items: QueueItem[] }) {
  if (items.length === 0) {
    // An empty queue is the goal, so it points somewhere useful rather than
    // being a dead end.
    return (
      <div className="bg-card rounded-2xl border p-6 text-center">
        <CheckCircle2 className="text-success mx-auto size-8" />
        <p className="mt-2 font-bold">Nothing needs you right now</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Crons are running, the float is healthy and the queue is clear.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href="/superadmin/health"
            className="hover:bg-accent rounded-lg border px-3 py-1.5 text-sm font-semibold"
          >
            Check platform health
          </Link>
          <Link
            href="/superadmin/churches?filter=at_risk"
            className="hover:bg-accent rounded-lg border px-3 py-1.5 text-sm font-semibold"
          >
            Review churches at risk
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const s = STYLE[item.severity];
        return (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-2xl border p-3.5 transition sm:p-4",
              s.wrap,
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl",
                s.chip,
              )}
            >
              <s.icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug">
                {item.message}
              </span>
              <span className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">
                {s.label}
              </span>
            </span>
            <ArrowRight className="text-muted-foreground size-4 shrink-0 transition group-hover:translate-x-0.5" />
          </Link>
        );
      })}
    </div>
  );
}
