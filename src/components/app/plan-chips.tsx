"use client";

import { createContext, useContext } from "react";
import type { FeatureKey } from "@/lib/entitlements";

/**
 * Which menu items carry a plan chip, and what it says.
 *
 * Worked out on the server from the live catalogue (planChipsFor in
 * lib/entitlements.ts) and handed down once from the app layout. The menu
 * used to work this out in the browser from the plan name alone, which could
 * only ever know the code's defaults — so a feature an admin ticked onto a
 * plan at /superadmin/plans would still have said "Pro" in the menu of a
 * church that had it.
 */
const PlanChipsContext = createContext<Partial<Record<FeatureKey, string>> | null>(null);

export function PlanChipsProvider({
  chips,
  children,
}: {
  chips: Partial<Record<FeatureKey, string>>;
  children: React.ReactNode;
}) {
  return <PlanChipsContext.Provider value={chips}>{children}</PlanChipsContext.Provider>;
}

export function usePlanChips(): Partial<Record<FeatureKey, string>> {
  const chips = useContext(PlanChipsContext);
  /*
   * Thrown rather than read as "no chips": a menu outside the provider would
   * otherwise show every module as included, which is the one wrong answer
   * that looks right.
   */
  if (!chips) throw new Error("PlanChip rendered outside PlanChipsProvider");
  return chips;
}
