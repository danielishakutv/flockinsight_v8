import {
  Award,
  BookOpen,
  Check,
  Crown,
  Droplet,
  GraduationCap,
  Heart,
  Shield,
  Star,
  type LucideIcon,
} from "lucide-react";
import { badgeColor, type EarnedBadge } from "@/lib/training-shared";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon | null> = {
  check: Check,
  award: Award,
  graduation: GraduationCap,
  star: Star,
  shield: Shield,
  droplet: Droplet,
  heart: Heart,
  book: BookOpen,
  crown: Crown,
  none: null,
};

/**
 * The icon a course picked, by key.
 *
 * A component rather than a `getIcon(key)` helper the caller then renders: a
 * function returning a component type reads to React (and to the
 * react-hooks/static-components lint) as a component being created during
 * render, which is the pattern that silently resets state. Doing the lookup
 * inside a stable component avoids that entirely.
 *
 * Renders nothing for the "none" key — a course may deliberately want a plain
 * text badge.
 */
export function BadgeIcon({
  icon,
  className,
  strokeWidth,
}: {
  icon: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = icon in ICONS ? ICONS[icon] : Check;
  if (!Icon) return null;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}

/** One earned badge — the chip that sits beside a member's name. */
export function TrainingBadge({
  badge,
  className,
}: {
  badge: EarnedBadge;
  className?: string;
}) {
  const color = badgeColor(badge.color);

  return (
    <span
      // The full course name is the tooltip, because the chip only has room
      // for an abbreviation and "FND" on its own tells a new volunteer nothing.
      title={
        badge.completedAt
          ? `${badge.name} — completed ${badge.completedAt}`
          : badge.name
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold ring-1 ring-inset",
        color.className,
        className,
      )}
    >
      <BadgeIcon icon={badge.icon} className="size-2.5" strokeWidth={2.75} />
      {badge.label}
    </span>
  );
}

/**
 * A member's badges, capped so a long list can't push the name off a phone.
 * The overflow is counted rather than dropped — "+3" says there is more to
 * see on the profile, where all of them are listed.
 */
export function TrainingBadges({
  badges,
  max = 3,
  className,
}: {
  badges: EarnedBadge[];
  max?: number;
  className?: string;
}) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const extra = badges.length - shown.length;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((b) => (
        <TrainingBadge key={b.courseId} badge={b} />
      ))}
      {extra > 0 && (
        <span
          title={badges
            .slice(max)
            .map((b) => b.name)
            .join(", ")}
          className="text-muted-foreground bg-muted shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
