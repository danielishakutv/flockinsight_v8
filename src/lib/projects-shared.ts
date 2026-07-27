// Client-safe project/pledge vocabulary — safe to import from client OR server
// components. The DB queries live in the server-only lib/projects.ts.

export type ProjectStatus = "active" | "completed" | "archived";
export type PledgeCadence =
  | "one_time"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";
export type PledgeStatus = "active" | "completed" | "cancelled";

export const CADENCES: { value: PledgeCadence; label: string }[] = [
  { value: "one_time", label: "One-time (lump sum)" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom…" },
];

/** Human label for a cadence, using the custom label when present. */
export function cadenceLabel(
  cadence: PledgeCadence,
  custom: string | null,
): string {
  if (cadence === "custom") return custom?.trim() || "Custom";
  return CADENCES.find((c) => c.value === cadence)?.label ?? cadence;
}
