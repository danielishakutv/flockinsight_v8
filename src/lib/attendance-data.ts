import { normalizeHeader } from "@/lib/members-data";

/** CSV column order for the template (export columns live in the export route). */
export const ATTENDANCE_CSV_HEADERS = [
  "Date",
  "Service / Event",
  "Total",
  "Male",
  "Female",
  "Children",
  "First-timers",
  "New converts",
  "Notes",
] as const;

/**
 * One illustrative row. Total is left blank because it's computed from
 * Male + Female + Children; fill Total only if you don't have a breakdown.
 */
export const ATTENDANCE_CSV_SAMPLE: string[] = [
  "2026-01-04",
  "Sunday Service",
  "",
  "120",
  "150",
  "30",
  "8",
  "3",
  "Communion Sunday",
];

export type AttendanceFieldKey =
  | "date"
  | "name"
  | "total"
  | "male"
  | "female"
  | "children"
  | "firstTimers"
  | "newConverts"
  | "notes";

const HEADER_ALIASES: Record<string, AttendanceFieldKey> = {
  date: "date",
  day: "date",
  service: "name",
  serviceevent: "name",
  event: "name",
  name: "name",
  servicename: "name",
  total: "total",
  totalcount: "total",
  attendance: "total",
  male: "male",
  men: "male",
  m: "male",
  female: "female",
  women: "female",
  w: "female",
  f: "female",
  children: "children",
  child: "children",
  kids: "children",
  c: "children",
  firsttimers: "firstTimers",
  firsttimer: "firstTimers",
  newcomers: "firstTimers",
  firsttime: "firstTimers",
  newconverts: "newConverts",
  newconvert: "newConverts",
  converts: "newConverts",
  notes: "notes",
  note: "notes",
  comment: "notes",
};

export function headerToAttendanceField(
  header: string,
): AttendanceFieldKey | null {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}

/** Parse a count: strips commas/spaces, floors to a non-negative int. */
export function normalizeCount(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1_000_000);
}
