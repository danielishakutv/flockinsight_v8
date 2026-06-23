export type GroupType =
  | "ministry"
  | "department"
  | "group"
  | "cell"
  | "committee"
  | "class";

export const GROUP_TYPES: GroupType[] = [
  "ministry",
  "department",
  "group",
  "cell",
  "committee",
  "class",
];

export const TYPE_LABEL: Record<GroupType, string> = {
  ministry: "Ministry",
  department: "Department",
  group: "Group",
  cell: "Home cell",
  committee: "Committee",
  class: "Class",
};

export const TYPE_VARIANT: Record<
  GroupType,
  "default" | "secondary" | "outline" | "success"
> = {
  ministry: "default",
  department: "secondary",
  group: "outline",
  cell: "success",
  committee: "secondary",
  class: "outline",
};

export const DAY_LABEL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "Sundays · 18:00", "Wednesdays", or null when nothing is set. */
export function meetingLabel(
  day: number | null,
  time: string | null,
): string | null {
  const parts: string[] = [];
  if (day !== null && day >= 0 && day <= 6) parts.push(`${DAY_LABEL[day]}s`);
  if (time) parts.push(time);
  return parts.length ? parts.join(" · ") : null;
}
