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
  /*
   * Youths and seniors. A church that counts them had them in Total and in no
   * column, so a re-imported export recomputed Total from the visible splits
   * and overwrote 140 with 100. Blank for a church that does not use them.
   */
  "Youth Male",
  "Youth Female",
  "Senior Male",
  "Senior Female",
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
  "",
  "",
  "",
  "",
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
  | AttendanceBandField
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
  // Youths and seniors.
  youthmale: "youthMale",
  youthsmale: "youthMale",
  youthfemale: "youthFemale",
  youthsfemale: "youthFemale",
  seniormale: "seniorMale",
  seniorsmale: "seniorMale",
  seniorfemale: "seniorFemale",
  seniorsfemale: "seniorFemale",
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

/** The four columns no export carried before youths and seniors were added. */
export const ATTENDANCE_BAND_FIELDS = [
  "youthMale",
  "youthFemale",
  "seniorMale",
  "seniorFemale",
] as const;
export type AttendanceBandField = (typeof ATTENDANCE_BAND_FIELDS)[number];
export type AttendanceBandCounts = Record<AttendanceBandField, number>;

/**
 * The youth and senior counts to store for one imported row, and its total.
 *
 * A column the file HAS is the file's word, blank meaning zero, like every
 * other count. A column the file does NOT have says nothing, so the session
 * already on file keeps its figure: every export made before these columns
 * existed lacks all four, and writing zeros would wipe a church's youth
 * counts on re-import, while leaving them out of the total is the bug the
 * columns were added to fix.
 *
 * So the total is every band the file states plus every band it kept, which
 * is how `recordAttendance` adds it up. A file with no split at all still
 * falls back to its Total column, as before.
 */
export function resolveImportedBands(opts: {
  /** Adults + teens + children, from the file. */
  base: number;
  /** The file's Total column. */
  fileTotal: number;
  /** Each band from the file, or null when the file has no such column. */
  bands: Record<AttendanceBandField, number | null>;
  /** The same session as already recorded, when it is. */
  stored: AttendanceBandCounts | null;
}): { bands: AttendanceBandCounts; total: number } {
  let stated = opts.base;
  let kept = 0;
  const bands = {} as AttendanceBandCounts;
  for (const k of ATTENDANCE_BAND_FIELDS) {
    const fromFile = opts.bands[k];
    if (fromFile !== null) {
      bands[k] = fromFile;
      stated += fromFile;
    } else {
      bands[k] = opts.stored?.[k] ?? 0;
      kept += bands[k];
    }
  }
  return { bands, total: stated > 0 ? stated + kept : opts.fileTotal };
}

/**
 * How a one-off session is recognised when a file comes back: its day and
 * its name.
 *
 * Named the way the export names it. A session with no service and no title
 * (its service was deleted) is written out as "Event", so that is what it is
 * matched as, or the row would be added again beside the session it came from.
 */
export function oneOffSessionKey(date: string, title: string | null): string {
  return `${date}|${(title ?? "").trim().toLowerCase() || "event"}`;
}
