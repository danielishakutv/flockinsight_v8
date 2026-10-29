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
import { REAL_USE } from "@/lib/real-use-sql";

/**
 * Real per-church activity signals: when somebody in each church last really
 * used FlockInsight, and in how many distinct weeks. What counts, and why the
 * old eight-table union overstated some churches and lost others entirely, is
 * in lib/real-use-sql.ts.
 */

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
      max(at) as last_seen,
      count(distinct date_trunc('week', at)) as active_weeks
    from (${REAL_USE}) as activity
    group by church_id
  `);

  return (res.rows as unknown as SignalRow[]).map((r) => ({
    churchId: r.church_id,
    lastSeenAt: r.last_seen ? new Date(r.last_seen) : null,
    activeWeeks: Number(r.active_weeks ?? 0),
  }));
}

const cachedSignals = unstable_cache(loadChurchSignals, ["church-signals-v2"], {
  revalidate: 60,
  tags: ["platform-stats"],
});

/**
 * NOTE: `unstable_cache` round-trips through JSON, so Dates come back as
 * strings on a cache hit and as Dates on a miss. Every cached accessor in this
 * file revives them, otherwise callers get an intermittent
 * "toISOString is not a function" depending purely on cache state.
 */
export async function getChurchSignals(): Promise<ChurchSignal[]> {
  const rows = await cachedSignals();
  return rows.map((r) => ({
    ...r,
    lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : null,
  }));
}

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
      -- A temp seat is an operator acting as the church, not a second person.
      (select count(*) from staff s where s.organization_id = c.id and s.temp = false) > 1 as has_staff,
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

export const getChurchFunnels = unstable_cache(loadFunnels, ["church-funnels-v2"], {
  revalidate: 60,
  tags: ["platform-stats"],
});

export type ChurchHealthRow = {
  churchId: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  /** The shared demo church: listed, but never in a platform count. */
  isDemo: boolean;
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
  is_demo: boolean;
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
        c.id, c.name, c.slug, c.plan, c.status, c.is_demo, c.created_at,
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
      isDemo: !!c.is_demo,
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

const cachedHealth = unstable_cache(loadChurchHealth, ["church-health-v2"], {
  revalidate: 60,
  tags: ["platform-stats"],
});

/** Revives Dates lost to the cache's JSON round-trip (see note above). */
export async function getChurchHealth(): Promise<ChurchHealthRow[]> {
  const rows = await cachedHealth();
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
    lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : null,
  }));
}

/**
 * The churches a platform number is about: every real one. The demo church
 * stays in getChurchHealth() so the Churches page can still list and manage
 * it, but it is one shared login rebuilt every two hours, so it is always
 * "healthy" and was quietly adding one to every active count.
 */
export async function getCountedChurchHealth(): Promise<ChurchHealthRow[]> {
  return (await getChurchHealth()).filter((r) => !r.isDemo);
}

export type HealthCounts = Record<ChurchHealth, number>;

export async function getHealthCounts(): Promise<HealthCounts> {
  const rows = await getCountedChurchHealth();
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
  const rows = await getCountedChurchHealth();
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
  const rows = await getCountedChurchHealth();
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter((r) => (r.lastSeenAt?.getTime() ?? 0) >= cutoff).length;
}
