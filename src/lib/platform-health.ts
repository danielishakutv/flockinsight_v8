import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  classifyHealth,
  funnelFor,
  type ChurchHealth,
  type FunnelFlags,
} from "@/lib/health-rules";

/**
 * Real per-church activity signals.
 *
 * The old dashboard derived "last activity" from attendance and giving dates
 * alone — two of roughly twenty modules — so churches busy with members,
 * messaging, forms, media or devotionals reported "No activity recorded yet".
 * Both of those columns are also user-entered *event* dates, so a church
 * backfilling last year's register read as inactive for a year.
 *
 * Everything here reads `created_at`: when the row was actually written.
 */

/**
 * Every table that proves a human touched the system, unioned. `analytics_event`
 * is the primary signal (a pageview by a signed-in user) but it is pruned at
 * 180 days, so the domain tables are the durable floor and must stay in.
 */
const ACTIVITY_UNION = sql`
  select church_id, created_at from analytics_event where church_id is not null
  union all select church_id, created_at from attendance_session
  union all select church_id, created_at from giving
  union all select church_id, created_at from member
  union all select church_id, created_at from communication_log
  union all select church_id, created_at from media
  union all select church_id, created_at from form
  union all select church_id, created_at from devotional
`;

export type ChurchSignal = {
  churchId: string;
  lastSeenAt: Date | null;
  /** Distinct ISO weeks in which this church did anything. */
  activeWeeks: number;
};

type SignalRow = { church_id: string; last_seen: string | null; active_weeks: string };

async function loadChurchSignals(): Promise<ChurchSignal[]> {
  const res = await db.execute(sql`
    select
      church_id,
      max(created_at) as last_seen,
      count(distinct date_trunc('week', created_at)) as active_weeks
    from (${ACTIVITY_UNION}) as activity
    group by church_id
  `);

  return (res.rows as unknown as SignalRow[]).map((r) => ({
    churchId: r.church_id,
    lastSeenAt: r.last_seen ? new Date(r.last_seen) : null,
    activeWeeks: Number(r.active_weeks ?? 0),
  }));
}

export const getChurchSignals = unstable_cache(
  loadChurchSignals,
  ["church-signals"],
  { revalidate: 60, tags: ["platform-stats"] },
);

export type FunnelRow = { churchId: string; flags: FunnelFlags; completed: number };

type FunnelSqlRow = {
  church_id: string;
  has_members: boolean;
  has_staff: boolean;
  has_attendance: boolean;
  has_giving: boolean;
  has_message: boolean;
};

/**
 * Which onboarding steps each church has completed. Shows where churches
 * stall, which is a product problem rather than a per-church one.
 */
async function loadFunnels(): Promise<FunnelRow[]> {
  const res = await db.execute(sql`
    select
      c.id as church_id,
      exists (select 1 from member m where m.church_id = c.id) as has_members,
      (select count(*) from staff s where s.organization_id = c.id) > 1 as has_staff,
      exists (select 1 from attendance_session a where a.church_id = c.id) as has_attendance,
      exists (select 1 from giving g where g.church_id = c.id) as has_giving,
      exists (select 1 from communication_log l where l.church_id = c.id) as has_message
    from church c
  `);

  return (res.rows as unknown as FunnelSqlRow[]).map((r) => {
    const flags: FunnelFlags = {
      members: !!r.has_members,
      staff: !!r.has_staff,
      attendance: !!r.has_attendance,
      giving: !!r.has_giving,
      message: !!r.has_message,
    };
    return { churchId: r.church_id, flags, completed: funnelFor(flags) };
  });
}

export const getChurchFunnels = unstable_cache(loadFunnels, ["church-funnels"], {
  revalidate: 60,
  tags: ["platform-stats"],
});

export type ChurchHealthRow = {
  churchId: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  activeWeeks: number;
  memberCount: number;
  sessionCount: number;
  health: ChurchHealth;
  funnel: FunnelFlags;
  funnelCompleted: number;
};

type ChurchBaseRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
  member_count: string;
  session_count: string;
};

/**
 * Every church with its health classification. One grouped query plus the
 * signal and funnel rollups, rather than a per-church fan-out.
 */
async function loadChurchHealth(): Promise<ChurchHealthRow[]> {
  const [base, signals, funnels] = await Promise.all([
    db.execute(sql`
      select
        c.id, c.name, c.slug, c.plan, c.status, c.created_at,
        (select count(*) from member m where m.church_id = c.id) as member_count,
        (select count(*) from attendance_session a where a.church_id = c.id) as session_count
      from church c
      order by c.created_at desc
    `),
    getChurchSignals(),
    getChurchFunnels(),
  ]);

  const signalMap = new Map(signals.map((s) => [s.churchId, s]));
  const funnelMap = new Map(funnels.map((f) => [f.churchId, f]));
  const now = new Date();

  return (base.rows as unknown as ChurchBaseRow[]).map((c) => {
    const signal = signalMap.get(c.id);
    const funnel = funnelMap.get(c.id);
    const createdAt = new Date(c.created_at);
    const memberCount = Number(c.member_count ?? 0);
    const sessionCount = Number(c.session_count ?? 0);

    return {
      churchId: c.id,
      name: c.name,
      slug: c.slug,
      plan: c.plan,
      status: c.status,
      createdAt,
      lastSeenAt: signal?.lastSeenAt ?? null,
      activeWeeks: signal?.activeWeeks ?? 0,
      memberCount,
      sessionCount,
      health: classifyHealth({
        status: c.status,
        createdAt,
        lastSeenAt: signal?.lastSeenAt ?? null,
        memberCount,
        sessionCount,
        activeWeeks: signal?.activeWeeks ?? 0,
        now,
      }),
      funnel: funnel?.flags ?? {
        members: false,
        staff: false,
        attendance: false,
        giving: false,
        message: false,
      },
      funnelCompleted: funnel?.completed ?? 0,
    };
  });
}

export const getChurchHealth = unstable_cache(
  loadChurchHealth,
  ["church-health"],
  { revalidate: 60, tags: ["platform-stats"] },
);

export type HealthCounts = Record<ChurchHealth, number>;

export async function getHealthCounts(): Promise<HealthCounts> {
  const rows = await getChurchHealth();
  const counts: HealthCounts = {
    healthy: 0,
    idle: 0,
    dormant: 0,
    at_risk: 0,
    never_activated: 0,
    suspended: 0,
  };
  for (const r of rows) counts[r.health]++;
  return counts;
}

/** Churches worth a phone call, worst first. */
export async function getChurchesNeedingAttention(
  limit = 8,
): Promise<ChurchHealthRow[]> {
  const rows = await getChurchHealth();
  return rows
    .filter((r) => r.health === "at_risk" || r.health === "never_activated")
    .sort((a, b) => {
      // At-risk first (recoverable revenue), then oldest silence.
      if (a.health !== b.health) return a.health === "at_risk" ? -1 : 1;
      const at = a.lastSeenAt?.getTime() ?? a.createdAt.getTime();
      const bt = b.lastSeenAt?.getTime() ?? b.createdAt.getTime();
      return at - bt;
    })
    .slice(0, limit);
}

/** Churches active in the last N days, by real signal. */
export async function getActiveChurchCount(days = 7): Promise<number> {
  const rows = await getChurchHealth();
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter((r) => (r.lastSeenAt?.getTime() ?? 0) >= cutoff).length;
}
