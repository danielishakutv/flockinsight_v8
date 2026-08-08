/**
 * Pure church-health classification. No database, no server-only imports — so
 * the rules can be unit-tested directly and reused on the client for badges.
 *
 * The rules answer a question the old dashboard could not: is this church
 * actually using FlockInsight? "Last activity" used to be derived from
 * attendance and giving dates alone, which reported "No activity recorded yet"
 * for churches busy with members, messaging, forms, media or devotionals.
 */

export type ChurchHealth =
  | "suspended"
  | "never_activated"
  | "at_risk"
  | "healthy"
  | "idle"
  | "dormant";

/** Seen within this many days = healthy. */
export const HEALTHY_DAYS = 7;
/** Seen within this many days = idle; beyond it = dormant. */
export const IDLE_DAYS = 30;
/** Silence of this many days flips a formerly-regular church to at-risk. */
export const AT_RISK_DAYS = 14;
/** How many distinct active weeks make a church "formerly regular". */
export const AT_RISK_MIN_WEEKS = 3;
/** Grace period before an empty church counts as failed onboarding. */
export const NEVER_ACTIVATED_DAYS = 7;

export type HealthInput = {
  status: string;
  createdAt: Date;
  /** Newest activity across every module; null when there is none at all. */
  lastSeenAt: Date | null;
  memberCount: number;
  sessionCount: number;
  /** Distinct ISO weeks in which this church did anything. */
  activeWeeks: number;
  now?: Date;
};

const DAY_MS = 86_400_000;

const daysBetween = (later: Date, earlier: Date): number =>
  (later.getTime() - earlier.getTime()) / DAY_MS;

/**
 * Classify a church. Order matters — the first matching rule wins, so that a
 * suspended church never reads as "healthy" and a church that never started
 * is never confused with one that stopped.
 */
export function classifyHealth(input: HealthInput): ChurchHealth {
  const now = input.now ?? new Date();

  if (input.status === "suspended") return "suspended";

  // Failed onboarding is a different problem from churn, and needs a different
  // conversation — separate it before any recency rule can claim the church.
  const ageDays = daysBetween(now, input.createdAt);
  if (
    ageDays >= NEVER_ACTIVATED_DAYS &&
    input.memberCount < 2 &&
    input.sessionCount === 0
  ) {
    return "never_activated";
  }

  const seenAt = input.lastSeenAt ?? input.createdAt;
  const silentDays = daysBetween(now, seenAt);

  // The signal worth acting on: a church that used to show up every week and
  // has now gone quiet is still winnable.
  if (input.activeWeeks >= AT_RISK_MIN_WEEKS && silentDays >= AT_RISK_DAYS) {
    return "at_risk";
  }

  if (silentDays <= HEALTHY_DAYS) return "healthy";
  if (silentDays <= IDLE_DAYS) return "idle";
  return "dormant";
}

export const FUNNEL_STEPS = [
  "members",
  "staff",
  "attendance",
  "giving",
  "message",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export type FunnelFlags = Record<FunnelStep, boolean>;

/** How many onboarding steps a church has completed (0..5). */
export function funnelFor(flags: FunnelFlags): number {
  return FUNNEL_STEPS.reduce((n, step) => n + (flags[step] ? 1 : 0), 0);
}

export const HEALTH_LABELS: Record<ChurchHealth, string> = {
  suspended: "Suspended",
  never_activated: "Never activated",
  at_risk: "At risk",
  healthy: "Healthy",
  idle: "Idle",
  dormant: "Dormant",
};
