import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { analyticsEvent } from "@/db/schema";

/**
 * First-party product analytics. A thin event log (pageviews + key actions)
 * that powers the superadmin "Usage" dashboard. Kept in our own DB so tenant
 * data never leaves; PostHog handles deep behavioural analysis separately.
 */

const FEATURE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  attendance: "Attendance",
  analytics: "Analytics",
  members: "Members",
  groups: "Groups",
  celebrations: "Celebrations",
  giving: "Giving",
  "follow-up": "Follow-up",
  media: "Media",
  forms: "Forms",
  devotionals: "Devotionals",
  communication: "Communication",
  settings: "Settings",
  notifications: "Notifications",
  help: "Help",
  "my-events": "Events",
};

/** Map a path to a friendly, groupable feature label. */
export function featureFromPath(path: string): string {
  const seg = (path || "/").replace(/^\/+/, "").split(/[/?#]/)[0] || "dashboard";
  return FEATURE_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1);
}

export async function recordPageview(input: {
  churchId: string | null;
  userId: string | null;
  sessionId: string | null;
  path: string;
  plan: string | null;
  role: string | null;
  durationMs?: number | null;
}): Promise<void> {
  await db.insert(analyticsEvent).values({
    churchId: input.churchId,
    userId: input.userId,
    sessionId: input.sessionId,
    kind: "pageview",
    name: featureFromPath(input.path),
    path: input.path.slice(0, 300),
    plan: input.plan,
    role: input.role,
    durationMs:
      input.durationMs != null && input.durationMs > 0
        ? Math.min(input.durationMs, 3_600_000)
        : null,
  });
}

/** Record a named action event (e.g. "attendance.record"). */
export async function recordAction(input: {
  churchId: string | null;
  userId: string | null;
  name: string;
  plan?: string | null;
  role?: string | null;
  props?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(analyticsEvent).values({
    churchId: input.churchId,
    userId: input.userId,
    kind: "action",
    name: input.name.slice(0, 120),
    plan: input.plan ?? null,
    role: input.role ?? null,
    props: input.props ?? null,
  });
}

/** Delete raw events older than `days` (called by the daily cron). */
export async function pruneOldEvents(days = 180): Promise<number> {
  const res = await db
    .delete(analyticsEvent)
    .where(sql`${analyticsEvent.createdAt} < now() - make_interval(days => ${days})`)
    .returning({ id: analyticsEvent.id });
  return res.length;
}

export type UsageOverview = {
  dau: number;
  wau: number;
  mau: number;
  activeChurches7: number;
  activeChurches30: number;
  totalEvents30: number;
  totalPageviews30: number;
  topFeatures: { name: string; views: number; churches: number }[];
  byPlan: { plan: string; events: number; churches: number }[];
  trend: { day: string; users: number; events: number }[];
  hasData: boolean;
};

type Row = Record<string, unknown>;
function num(v: unknown): number {
  return Number(v ?? 0);
}

/** Everything the superadmin Usage dashboard needs, in one call. */
export async function getUsageOverview(): Promise<UsageOverview> {
  const [
    activeUsers,
    activeChurches,
    totals,
    topFeatures,
    byPlan,
    trend,
  ] = await Promise.all([
    db.execute(sql`
      select
        count(distinct user_id) filter (where created_at >= now() - interval '1 day') as dau,
        count(distinct user_id) filter (where created_at >= now() - interval '7 days') as wau,
        count(distinct user_id) filter (where created_at >= now() - interval '30 days') as mau
      from analytics_event
      where user_id is not null and created_at >= now() - interval '30 days'
    `),
    db.execute(sql`
      select
        count(distinct church_id) filter (where created_at >= now() - interval '7 days') as c7,
        count(distinct church_id) filter (where created_at >= now() - interval '30 days') as c30
      from analytics_event
      where church_id is not null and created_at >= now() - interval '30 days'
    `),
    db.execute(sql`
      select
        count(*) as events,
        count(*) filter (where kind = 'pageview') as pageviews
      from analytics_event
      where created_at >= now() - interval '30 days'
    `),
    db.execute(sql`
      select name, count(*) as views, count(distinct church_id) as churches
      from analytics_event
      where kind = 'pageview' and created_at >= now() - interval '30 days'
      group by name
      order by views desc
      limit 15
    `),
    db.execute(sql`
      select coalesce(plan, 'unknown') as plan,
             count(*) as events,
             count(distinct church_id) as churches
      from analytics_event
      where created_at >= now() - interval '30 days'
      group by coalesce(plan, 'unknown')
      order by events desc
    `),
    db.execute(sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
             count(distinct user_id) as users,
             count(*) as events
      from analytics_event
      where created_at >= now() - interval '30 days'
      group by 1
      order by 1
    `),
  ]);

  const au = (activeUsers.rows[0] ?? {}) as Row;
  const ac = (activeChurches.rows[0] ?? {}) as Row;
  const tt = (totals.rows[0] ?? {}) as Row;

  return {
    dau: num(au.dau),
    wau: num(au.wau),
    mau: num(au.mau),
    activeChurches7: num(ac.c7),
    activeChurches30: num(ac.c30),
    totalEvents30: num(tt.events),
    totalPageviews30: num(tt.pageviews),
    topFeatures: (topFeatures.rows as Row[]).map((r) => ({
      name: String(r.name),
      views: num(r.views),
      churches: num(r.churches),
    })),
    byPlan: (byPlan.rows as Row[]).map((r) => ({
      plan: String(r.plan),
      events: num(r.events),
      churches: num(r.churches),
    })),
    trend: (trend.rows as Row[]).map((r) => ({
      day: String(r.day),
      users: num(r.users),
      events: num(r.events),
    })),
    hasData: num(tt.events) > 0,
  };
}
