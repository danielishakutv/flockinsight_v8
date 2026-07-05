import { normalizeHeader } from "@/lib/members-data";

/** CSV column order for the template (export columns live in the export route). */
export const ATTENDANCE_CSV_HEADERS = [
  "Date",
  "Service / Event",
  "Total",
  "Adult Male",
  "Adult Female",
  "Teen Male",
  "Teen Female",
  "Child Male",
  "Child Female",
  "Children",
  "First-timer Male",
  "First-timer Female",
  "First-timers",
  "New Convert Male",
  "New Convert Female",
  "New converts",
  "Notes",
] as const;

/**
 * One illustrative row. The Total / Children / First-timers / New converts
 * columns are left blank because they're computed from the gender splits;
 * fill them only if you don't have a split (e.g. older records).
 */
export const ATTENDANCE_CSV_SAMPLE: string[] = [
  "2026-01-04",
  "Sunday Service",
  "",
  "120",
  "150",
  "20",
  "25",
  "15",
  "18",
  "",
  "5",
  "3",
  "",
  "2",
  "1",
  "",
  "Communion Sunday",
];

export type AttendanceFieldKey =
  | "date"
  | "name"
  | "total"
  | "male"
  | "female"
  | "teenMale"
  | "teenFemale"
  | "childMale"
  | "childFemale"
  | "children"
  | "firstTimerMale"
  | "firstTimerFemale"
  | "firstTimers"
  | "newConvertMale"
  | "newConvertFemale"
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
  // Adults ("Male"/"Men" kept for files exported before the split).
  male: "male",
  men: "male",
  m: "male",
  adultmale: "male",
  adultmen: "male",
  female: "female",
  women: "female",
  w: "female",
  f: "female",
  adultfemale: "female",
  adultwomen: "female",
  // Teens.
  teenmale: "teenMale",
  teenmen: "teenMale",
  teenboys: "teenMale",
  teensmale: "teenMale",
  teenfemale: "teenFemale",
  teenwomen: "teenFemale",
  teengirls: "teenFemale",
  teensfemale: "teenFemale",
  // Children.
  childmale: "childMale",
  childrenmale: "childMale",
  boys: "childMale",
  childfemale: "childFemale",
  childrenfemale: "childFemale",
  girls: "childFemale",
  children: "children",
  child: "children",
  kids: "children",
  c: "children",
  // First-timers.
  firsttimermale: "firstTimerMale",
  firsttimersmale: "firstTimerMale",
  firsttimerfemale: "firstTimerFemale",
  firsttimersfemale: "firstTimerFemale",
  firsttimers: "firstTimers",
  firsttimer: "firstTimers",
  newcomers: "firstTimers",
  firsttime: "firstTimers",
  // New converts.
  newconvertmale: "newConvertMale",
  newconvertsmale: "newConvertMale",
  convertmale: "newConvertMale",
  newconvertfemale: "newConvertFemale",
  newconvertsfemale: "newConvertFemale",
  convertfemale: "newConvertFemale",
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
