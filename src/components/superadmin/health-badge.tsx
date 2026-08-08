import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CircleSlash,
  Clock,
  Moon,
  PauseCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HEALTH_LABELS, type ChurchHealth } from "@/lib/health-rules";
import { cn } from "@/lib/utils";

type Variant = React.ComponentProps<typeof Badge>["variant"];

const STYLES: Record<ChurchHealth, { variant: Variant; icon: LucideIcon }> = {
  healthy: { variant: "success", icon: Sparkles },
  idle: { variant: "secondary", icon: Clock },
  dormant: { variant: "outline", icon: Moon },
  at_risk: { variant: "warning", icon: AlertTriangle },
  never_activated: { variant: "outline", icon: CircleSlash },
  suspended: { variant: "destructive", icon: PauseCircle },
};

export function HealthBadge({
  health,
  className,
}: {
  health: ChurchHealth;
  className?: string;
}) {
  const { variant, icon: Icon } = STYLES[health];
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {HEALTH_LABELS[health]}
    </Badge>
  );
}

/**
 * "Last seen" in plain words. Says "Never signed in" only when that is
 * genuinely true — the old dashboard printed "No activity recorded yet" for
 * churches that were simply not using attendance or giving.
 */
export function LastSeen({
  at,
  className,
}: {
  at: Date | string | null;
  className?: string;
}) {
  if (!at) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        Never signed in
      </span>
    );
  }
  const date = typeof at === "string" ? new Date(at) : at;
  return (
    <span className={className} title={date.toLocaleString()}>
      Active {formatDistanceToNowStrict(date, { addSuffix: true })}
    </span>
  );
}

/** Onboarding progress as filled dots — five steps, most churches stall early. */
export function FunnelDots({
  completed,
  total = 5,
  className,
}: {
  completed: number;
  total?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={`${completed} of ${total} onboarding steps done`}
      aria-label={`${completed} of ${total} onboarding steps done`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            i < completed ? "bg-primary" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}
