import "server-only";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "@/db";
import {
  communicationLog,
  event,
  form,
  formResponse,
  group,
  media,
  member,
  subscriber,
} from "@/db/schema";

/* ============================================================
 * Dashboard aggregates — the "how is my church doing?" numbers pulled from
 * across the modules, so the home screen can show them at a glance.
 * ========================================================== */

export type MemberBreakdown = {
  total: number;
  male: number;
  female: number;
  unknownGender: number;
  active: number;
  inactive: number;
  visitors: number;
  newConverts: number;
  withPhone: number;
  withEmail: number;
};

/** Gender, status and reachability split of the whole congregation. */
export async function getMemberBreakdown(
  churchId: string,
): Promise<MemberBreakdown> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      male: sql<number>`count(*) filter (where ${member.gender} = 'male')`,
      female: sql<number>`count(*) filter (where ${member.gender} = 'female')`,
      unknownGender: sql<number>`count(*) filter (where ${member.gender} is null)`,
      active: sql<number>`count(*) filter (where ${member.status} = 'active')`,
      inactive: sql<number>`count(*) filter (where ${member.status} = 'inactive')`,
      visitors: sql<number>`count(*) filter (where ${member.status} = 'visitor')`,
      newConverts: sql<number>`count(*) filter (where ${member.status} = 'new_convert')`,
      withPhone: sql<number>`count(*) filter (where ${member.phone} is not null and ${member.phone} <> '')`,
      withEmail: sql<number>`count(*) filter (where ${member.email} is not null and ${member.email} <> '')`,
    })
    .from(member)
    .where(eq(member.churchId, churchId));

  return {
    total: Number(row?.total ?? 0),
    male: Number(row?.male ?? 0),
    female: Number(row?.female ?? 0),
    unknownGender: Number(row?.unknownGender ?? 0),
    active: Number(row?.active ?? 0),
    inactive: Number(row?.inactive ?? 0),
    visitors: Number(row?.visitors ?? 0),
    newConverts: Number(row?.newConverts ?? 0),
    withPhone: Number(row?.withPhone ?? 0),
    withEmail: Number(row?.withEmail ?? 0),
  };
}

export type RegistrationPoint = { label: string; people: number };

/**
 * People added to the church per month, oldest → newest. Months with nobody
 * are kept as zeroes so the chart doesn't lie about the gaps.
 */
export async function getRegistrationTrend(
  churchId: string,
  months = 6,
): Promise<{ points: RegistrationPoint[]; total: number }> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() - (months - 1));

  const bucket = sql<string>`date_trunc('month', ${member.createdAt})`;
  const rows = await db
    .select({ bucket, people: sql<number>`count(*)` })
    .from(member)
    .where(and(eq(member.churchId, churchId), gte(member.createdAt, start)))
    .groupBy(bucket)
    .orderBy(bucket);

  const counts = new Map<string, number>();
  for (const r of rows)
    counts.set(format(new Date(r.bucket), "yyyy-MM"), Number(r.people));

  const points: RegistrationPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    points.push({
      label: format(d, "MMM"),
      people: counts.get(format(d, "yyyy-MM")) ?? 0,
    });
  }
  return { points, total: points.reduce((a, p) => a + p.people, 0) };
}

export type ModuleHighlights = {
  groups: number;
  followUpOpen: number;
  forms: number;
  formResponses: number;
  mediaFiles: number;
  subscribers: number;
  upcomingEvents: number;
  messagesSent: number;
  messagesFailed: number;
};

/** One headline number from each module, for the "across your church" grid. */
export async function getModuleHighlights(
  churchId: string,
  since: Date,
): Promise<ModuleHighlights> {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    [groups],
    [followUp],
    [forms],
    [responses],
    [files],
    [subs],
    [events],
    [messages],
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(group)
      .where(and(eq(group.churchId, churchId), eq(group.isActive, true))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(member)
      .where(
        and(
          eq(member.churchId, churchId),
          // Everyone actively being followed up: visitors/new converts plus
          // anyone added by hand, minus the ones already closed out.
          or(
            inArray(member.status, ["visitor", "new_convert"]),
            eq(member.inFollowUp, true),
          ),
          or(
            isNull(member.followUpStatus),
            inArray(member.followUpStatus, ["new", "contacted", "in_progress"]),
          ),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(form)
      .where(and(eq(form.churchId, churchId), eq(form.status, "open"))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(formResponse)
      .where(
        and(
          eq(formResponse.churchId, churchId),
          gte(formResponse.createdAt, since),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(media)
      .where(eq(media.churchId, churchId)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(subscriber)
      .where(
        and(eq(subscriber.churchId, churchId), eq(subscriber.status, "active")),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(event)
      .where(and(eq(event.churchId, churchId), gte(event.date, todayIso))),
    db
      .select({
        sent: sql<number>`coalesce(sum(${communicationLog.sent}), 0)`,
        failed: sql<number>`coalesce(sum(${communicationLog.failed}), 0)`,
      })
      .from(communicationLog)
      .where(
        and(
          eq(communicationLog.churchId, churchId),
          gte(communicationLog.createdAt, since),
        ),
      ),
  ]);

  return {
    groups: Number(groups?.n ?? 0),
    followUpOpen: Number(followUp?.n ?? 0),
    forms: Number(forms?.n ?? 0),
    formResponses: Number(responses?.n ?? 0),
    mediaFiles: Number(files?.n ?? 0),
    subscribers: Number(subs?.n ?? 0),
    upcomingEvents: Number(events?.n ?? 0),
    messagesSent: Number(messages?.sent ?? 0),
    messagesFailed: Number(messages?.failed ?? 0),
  };
}
