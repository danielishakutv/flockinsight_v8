// Pure roadmap constants — safe to import from client OR server components.

/**
 * Two statuses. Either it is still to do, or it has shipped.
 *
 * There used to be five, laid out as a kanban board: idea, planned,
 * in_progress, shipped, parked. The only move anybody actually made was "this
 * is done now", usually one-handed on a phone, and the other four columns
 * turned writing an idea down into a filing decision. So the board is a list
 * and the five are two.
 *
 * Migration 0094 kept each row's original value in `legacy_status`, so the
 * distinction is recoverable if this turns out to be too blunt.
 */
export type RoadmapStatus = "todo" | "shipped";

export type RoadmapPriority = "critical" | "high" | "medium" | "low";

export const ROADMAP_STATUSES: {
  value: RoadmapStatus;
  label: string;
  hint: string;
  className: string;
}[] = [
  {
    value: "todo",
    label: "To do",
    hint: "Not shipped yet.",
    className: "bg-slate-500/12 text-slate-700 dark:text-slate-300",
  },
  {
    value: "shipped",
    label: "Shipped",
    hint: "Live, with the date and the platform size that day.",
    className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
];

/** The order the list reads: what is left, then what is done. */
export const BOARD_ORDER: RoadmapStatus[] = ["todo", "shipped"];

/** True for a value that is a status, for anything parsing input. */
export function isRoadmapStatus(v: unknown): v is RoadmapStatus {
  return v === "todo" || v === "shipped";
}

/**
 * Read a status out of whatever arrived, including the five old names.
 *
 * The API and any bookmarked link may still say "planned" or "in_progress"
 * long after the columns went. Rejecting those would be technically correct
 * and practically useless: every one of them meant "not shipped yet", so they
 * are read as `todo` rather than refused. `null` for something that was never
 * a status at all, which the caller reports — it is a typo, not a synonym.
 */
export function readStatus(v: unknown): RoadmapStatus | null {
  if (isRoadmapStatus(v)) return v;
  if (v === "idea" || v === "planned" || v === "in_progress" || v === "parked")
    return "todo";
  return null;
}

export const ROADMAP_PRIORITIES: {
  value: RoadmapPriority;
  label: string;
  className: string;
}[] = [
  {
    value: "critical",
    label: "Critical",
    className: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
  {
    value: "high",
    label: "High",
    className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  {
    value: "medium",
    label: "Medium",
    className: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  {
    value: "low",
    label: "Low",
    className: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
  },
];

/** Most important first. The to-do list is read top to bottom. */
export const PRIORITY_RANK: Record<RoadmapPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function statusMeta(s: string) {
  return ROADMAP_STATUSES.find((x) => x.value === s) ?? ROADMAP_STATUSES[0];
}

export function priorityMeta(p: string) {
  return ROADMAP_PRIORITIES.find((x) => x.value === p) ?? ROADMAP_PRIORITIES[2];
}

/** Suggested areas. Free text underneath, so a church module can be added. */
export const ROADMAP_AREAS = [
  "Attendance",
  "Members",
  "Groups",
  "Giving",
  "Finance",
  "Training",
  "Communication",
  "Follow-up",
  "Events",
  "Forms",
  "Media",
  "Reports",
  "Devotionals",
  "Public pages",
  "Platform",
  "Mobile",
  "Billing",
  "Admin",
];
