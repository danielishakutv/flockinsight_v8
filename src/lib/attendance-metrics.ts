import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";

export type WeekPoint = {
  weekStart: string; // YYYY-MM-DD (Sunday)
  label: string; // e.g. "May 4"
  total: number;
  male: number;
  female: number;
  children: number;
  firstTimers: number;
  newConverts: number;
  count: number; // number of sessions in the week
};

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfWeekSunday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** Weekly-bucketed attendance for the last `weeks` weeks (oldest → newest). */
export async function getWeeklySeries(
  churchId: string,
  weeks = 12,
): Promise<WeekPoint[]> {
  const start = startOfWeekSunday(new Date());
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const startStr = isoDate(start);

  const rows = await db
    .select({
      date: attendanceSession.date,
      total: attendanceSession.totalCount,
      male: attendanceSession.maleCount,
      female: attendanceSession.femaleCount,
      children: attendanceSession.childrenCount,
      firstTimers: attendanceSession.firstTimerCount,
      newConverts: attendanceSession.newConvertCount,
    })
    .from(attendanceSession)
    .where(
      and(
        eq(attendanceSession.churchId, churchId),
        gte(attendanceSession.date, startStr),
      ),
    );

  const buckets = new Map<string, WeekPoint>();
  for (let i = 0; i < weeks; i++) {
    const ws = new Date(start);
    ws.setDate(start.getDate() + i * 7);
    const key = isoDate(ws);
    buckets.set(key, {
      weekStart: key,
      label: format(ws, "MMM d"),
      total: 0,
      male: 0,
      female: 0,
      children: 0,
      firstTimers: 0,
      newConverts: 0,
      count: 0,
    });
  }

  for (const r of rows) {
    const key = isoDate(startOfWeekSunday(parseISO(r.date)));
    const b = buckets.get(key);
    if (!b) continue;
    b.total += r.total;
    b.male += r.male;
    b.female += r.female;
    b.children += r.children;
    b.firstTimers += r.firstTimers;
    b.newConverts += r.newConverts;
    b.count += 1;
  }

  return [...buckets.values()];
}

export type LastSession = {
  total: number;
  date: string;
  name: string;
};

/** The most recently recorded session (by date, then entry time). */
export async function getLastSession(
  churchId: string,
): Promise<LastSession | null> {
  const [row] = await db
    .select({
      total: attendanceSession.totalCount,
      date: attendanceSession.date,
      title: attendanceSession.title,
      serviceName: service.name,
    })
    .from(attendanceSession)
    .leftJoin(service, eq(service.id, attendanceSession.serviceId))
    .where(eq(attendanceSession.churchId, churchId))
    .orderBy(desc(attendanceSession.date), desc(attendanceSession.createdAt))
    .limit(1);

  if (!row) return null;
  return {
    total: row.total,
    date: row.date,
    name: row.serviceName ?? row.title ?? "Service",
  };
}

/** Average of the non-empty weekly totals over the most recent `n` weeks. */
export function weeklyAverage(series: WeekPoint[], n = 8): number {
  const recent = series.slice(-n).filter((w) => w.count > 0);
  if (!recent.length) return 0;
  const sum = recent.reduce((a, w) => a + w.total, 0);
  return Math.round(sum / recent.length);
}

/**
 * Growth %: average of last `n` weeks vs the `n` weeks before that.
 * Returns null when there isn't enough data to compare.
 */
export function growthPct(series: WeekPoint[], n = 4): number | null {
  const withData = series.filter((w) => w.count > 0);
  if (withData.length < 2) return null;
  const recent = withData.slice(-n);
  const prior = withData.slice(-2 * n, -n);
  if (!recent.length || !prior.length) return null;
  const avg = (arr: WeekPoint[]) =>
    arr.reduce((a, w) => a + w.total, 0) / arr.length;
  const prevAvg = avg(prior);
  if (prevAvg === 0) return null;
  return Math.round(((avg(recent) - prevAvg) / prevAvg) * 100);
}
