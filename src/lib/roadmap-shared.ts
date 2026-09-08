// Pure roadmap constants — safe to import from client OR server components.

export type RoadmapStatus =
  | "idea"
  | "planned"
  | "in_progress"
  | "shipped"
  | "parked";

export type RoadmapPriority = "critical" | "high" | "medium" | "low";

export const ROADMAP_STATUSES: {
  value: RoadmapStatus;
  label: string;
  hint: string;
  className: string;
}[] = [
  {
    value: "idea",
    label: "Idea",
    hint: "Captured. Not committed to.",
    className: "bg-slate-500/12 text-slate-700 dark:text-slate-300",
  },
  {
    value: "planned",
    label: "Planned",
    hint: "Committed. Waiting its turn.",
    className: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  {
    value: "in_progress",
    label: "Building",
    hint: "Being worked on now.",
    className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  {
    value: "shipped",
    label: "Shipped",
    hint: "Live, with the date and the platform size that day.",
    className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "parked",
    label: "Parked",
    hint: "Deliberately not doing, for now.",
    className: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
];

/** Board column order — the queue reads left to right. */
export const BOARD_ORDER: RoadmapStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "shipped",
  "parked",
];

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
