/** Client-safe vocabulary for church networks (no database imports). */

export type RangeKey = "30d" | "90d" | "mtd" | "ytd" | "12m";

export const RANGES: { id: RangeKey; label: string; days?: number }[] = [
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "mtd", label: "This month" },
  { id: "ytd", label: "This year" },
  { id: "12m", label: "Last 12 months", days: 365 },
];

/** Start date for a range key, in the reader's own timezone. */
export function rangeStart(key: RangeKey, now: Date = new Date()): Date {
  switch (key) {
    case "mtd":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    default: {
      const days = RANGES.find((r) => r.id === key)?.days ?? 30;
      return new Date(now.getTime() - days * 86_400_000);
    }
  }
}

export function rangeLabel(key: RangeKey): string {
  return RANGES.find((r) => r.id === key)?.label ?? "Last 30 days";
}

export type BranchFilters = {
  range: RangeKey;
  zone: string;
  state: string;
  city: string;
  country: string;
  q: string;
};

export const ALL = "all";

export function parseBranchFilters(
  sp: Record<string, string | undefined>,
): BranchFilters {
  const range = (sp.range ?? "30d") as RangeKey;
  return {
    range: RANGES.some((r) => r.id === range) ? range : "30d",
    zone: sp.zone?.trim() || ALL,
    state: sp.state?.trim() || ALL,
    city: sp.city?.trim() || ALL,
    country: sp.country?.trim() || ALL,
    q: sp.q?.trim() ?? "",
  };
}

/** A branch row as the dashboard shows it. */
export type BranchStat = {
  churchId: string;
  name: string;
  zone: string | null;
  city: string | null;
  state: string | null;
  country: string;
  members: number;
  newMembers: number;
  services: number;
  attendanceTotal: number;
  attendanceAvg: number;
  giving: number;
  currency: string;
  lastActivity: string | null;
};
