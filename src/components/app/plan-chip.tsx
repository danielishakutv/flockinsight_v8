"use client";

import { FEATURES, type FeatureKey } from "@/lib/entitlements";
import { usePlanChips } from "@/components/app/plan-chips";
import { cn } from "@/lib/utils";

/**
 * "Pro" beside a menu item the church's plan does not include.
 *
 * Shown rather than the item being hidden. A church that never sees Finance in
 * the menu never finds out the next tier has it — and hiding it would also hide
 * the records of the five churches that already have data in modules they do not
 * pay for. Clicking through lands on the module, readable, with its banner.
 *
 * What it says comes from the live catalogue, worked out on the server — see
 * components/app/plan-chips.tsx.
 */
export function PlanChip({
  feature,
  className,
}: {
  feature: FeatureKey;
  className?: string;
}) {
  const label = usePlanChips()[feature];
  if (!label) return null;
  return (
    <span
      title={FEATURES[feature].blurb}
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
        "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        className,
      )}
    >
      {label}
    </span>
  );
}
