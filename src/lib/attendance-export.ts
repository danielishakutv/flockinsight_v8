import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";

export type AttendanceExportRow = {
  date: string; // YYYY-MM-DD
  name: string; // service name, else one-off title, else "Event"
  total: number;
  male: number;
  female: number;
  children: number;
  firstTimers: number;
  newConverts: number;
  notes: string | null;
};

export type AttendanceSummary = {
  sessions: number;
  total: number;
  male: number;
  female: number;
  children: number;
  firstTimers: number;
  newConverts: number;
  average: number;
  peak: number;
  firstDate: string | null; // oldest
  lastDate: string | null; // newest
};

/** Every recorded attendance session for a church, newest first. */
export async function getAttendanceRows(
  churchId: string,
): Promise<AttendanceExportRow[]> {
  const rows = await db
    .select({
      date: attendanceSession.date,
      title: attendanceSession.title,
      serviceName: service.name,
      total: attendanceSession.totalCount,
      male: attendanceSession.maleCount,
      female: attendanceSession.femaleCount,
      children: attendanceSession.childrenCount,
      firstTimers: attendanceSession.firstTimerCount,
      newConverts: attendanceSession.newConvertCount,
      notes: attendanceSession.notes,
    })
    .from(attendanceSession)
    .leftJoin(service, eq(service.id, attendanceSession.serviceId))
    .where(eq(attendanceSession.churchId, churchId))
    .orderBy(desc(attendanceSession.date), desc(attendanceSession.createdAt));

  return rows.map((r) => ({
    date: r.date,
    name: r.serviceName ?? r.title ?? "Event",
    total: r.total,
    male: r.male,
    female: r.female,
    children: r.children,
    firstTimers: r.firstTimers,
    newConverts: r.newConverts,
    notes: r.notes,
  }));
}

/** Totals, averages and the covered date range for a set of rows. */
export function summarizeAttendance(
  rows: AttendanceExportRow[],
): AttendanceSummary {
  const s: AttendanceSummary = {
    sessions: rows.length,
    total: 0,
    male: 0,
    female: 0,
    children: 0,
    firstTimers: 0,
    newConverts: 0,
    average: 0,
    peak: 0,
    firstDate: null,
    lastDate: null,
  };

  for (const r of rows) {
    s.total += r.total;
    s.male += r.male;
    s.female += r.female;
    s.children += r.children;
    s.firstTimers += r.firstTimers;
    s.newConverts += r.newConverts;
    if (r.total > s.peak) s.peak = r.total;
  }
  s.average = rows.length ? Math.round(s.total / rows.length) : 0;
  if (rows.length) {
    // rows are sorted newest → oldest.
    s.lastDate = rows[0].date;
    s.firstDate = rows[rows.length - 1].date;
  }
  return s;
}
