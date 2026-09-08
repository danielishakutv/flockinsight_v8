// Pure training helpers — safe to import from client OR server components.
// (No DB/session imports here; the server-only queries live in training.ts.)

export type TrainingKind = "class" | "training" | "course";
export type CohortStatus = "upcoming" | "running" | "completed" | "cancelled";
export type EnrollmentStatus =
  | "enrolled"
  | "in_progress"
  | "completed"
  | "withdrawn"
  | "failed";

export const TRAINING_KINDS: { value: TrainingKind; label: string; hint: string }[] =
  [
    {
      value: "class",
      label: "Class",
      hint: "For the congregation — Foundation, Baptism, Pre-Marital…",
    },
    {
      value: "training",
      label: "Training",
      hint: "For workers — leaders, pastors, teachers, ushers…",
    },
    { value: "course", label: "Course", hint: "Anything else." },
  ];

export const COHORT_STATUSES: { value: CohortStatus; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const ENROLLMENT_STATUSES: { value: EnrollmentStatus; label: string }[] = [
  { value: "enrolled", label: "Enrolled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "failed", label: "Did not pass" },
];

/**
 * Badge colours. Full literal Tailwind classes, because Tailwind scans source
 * text — a class built by interpolation is purged from the stylesheet and the
 * badge renders unstyled.
 */
export const TRAINING_BADGE_COLORS: Record<string, { label: string; className: string; dot: string }> =
  {
    indigo: {
      label: "Indigo",
      className:
        "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
      dot: "bg-indigo-500",
    },
    emerald: {
      label: "Emerald",
      className:
        "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    amber: {
      label: "Amber",
      className:
        "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
      dot: "bg-amber-500",
    },
    rose: {
      label: "Rose",
      className: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
      dot: "bg-rose-500",
    },
    sky: {
      label: "Sky",
      className: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
      dot: "bg-sky-500",
    },
    violet: {
      label: "Violet",
      className:
        "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300",
      dot: "bg-violet-500",
    },
    teal: {
      label: "Teal",
      className: "bg-teal-500/12 text-teal-700 ring-teal-500/25 dark:text-teal-300",
      dot: "bg-teal-500",
    },
    slate: {
      label: "Slate",
      className:
        "bg-slate-500/12 text-slate-700 ring-slate-500/25 dark:text-slate-300",
      dot: "bg-slate-500",
    },
  };

export const BADGE_COLOR_KEYS = Object.keys(TRAINING_BADGE_COLORS);

export function badgeColor(key: string | null | undefined) {
  return TRAINING_BADGE_COLORS[key ?? ""] ?? TRAINING_BADGE_COLORS.indigo;
}

/** Icon keys a course can pick. Mapped to components in training-badge.tsx. */
export const TRAINING_BADGE_ICONS = [
  "check",
  "award",
  "graduation",
  "star",
  "shield",
  "droplet",
  "heart",
  "book",
  "crown",
  "none",
] as const;
export type TrainingBadgeIcon = (typeof TRAINING_BADGE_ICONS)[number];

/** What a member earned by completing a course — the shape lists render. */
export type EarnedBadge = {
  courseId: string;
  name: string;
  label: string;
  color: string;
  icon: string;
  level: number;
  completedAt: string | null;
};

/**
 * The short text on the badge. A course can set its own; otherwise we derive
 * something compact from the name, because "Foundation Class For New Converts"
 * beside every name in a list is unreadable.
 */
export function badgeLabelFor(course: {
  name: string;
  badgeLabel?: string | null;
}): string {
  const explicit = course.badgeLabel?.trim();
  if (explicit) return explicit;
  const words = course.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // One word: use it as-is if it's already short.
  if (words.length === 1) return words[0].slice(0, 14);
  // Otherwise initials, which stay readable at any list density.
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A member's standing: the highest-level course they have completed. This is
 * the "ranking" shown beside a name when there isn't room for every badge.
 */
export function highestBadge(badges: EarnedBadge[]): EarnedBadge | null {
  if (badges.length === 0) return null;
  return badges.reduce((best, b) => (b.level > best.level ? b : best));
}

/**
 * Did this result pass? A course with no pass mark isn't scored, so finishing
 * it is passing it.
 */
export function passed(
  score: number | null | undefined,
  passMark: number | null | undefined,
): boolean {
  if (passMark == null) return true;
  if (score == null) return false;
  return score >= passMark;
}

/** Position within a scored cohort, dense-ranked so ties share a place. */
export function rankScores<T extends { score: number | null }>(
  rows: T[],
): (T & { rank: number | null })[] {
  const scored = rows.filter((r) => r.score != null);
  const distinct = [...new Set(scored.map((r) => r.score as number))].sort(
    (a, b) => b - a,
  );
  const place = new Map(distinct.map((s, i) => [s, i + 1]));
  return rows.map((r) => ({
    ...r,
    rank: r.score == null ? null : (place.get(r.score) ?? null),
  }));
}
