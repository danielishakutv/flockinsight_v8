import "server-only";
import { getChurchHealth } from "@/lib/platform-health";
import {
  FUNNEL_STEPS,
  type ChurchHealth,
  type FunnelFlags,
  type FunnelStep,
} from "@/lib/health-rules";
import type { Sample } from "@/lib/thin-data";

/**
 * Who signed up and never started, and what they stopped at.
 *
 * `getChurchesNeedingAttention` already ranks the churches worth a call, but it
 * cannot say *where* a church stalled — and that is the whole question. A
 * church with no members needs a different conversation from one that added a
 * hundred and never recorded a service; the first never found the front door,
 * the second found it and did not see the point. One list treating them the
 * same produces one email that suits neither.
 */

/** What to say to a church that got this far and no further. */
const STEP_COPY: Record<FunnelStep, { label: string; blocked: string }> = {
  members: {
    label: "No members yet",
    blocked: "Signed up, then stopped. Nobody has been added but the owner.",
  },
  staff: {
    label: "Nobody else invited",
    blocked: "Running it alone — no other account can help with the register.",
  },
  attendance: {
    label: "No service recorded",
    blocked: "Has people on the books but has never recorded a Sunday.",
  },
  giving: {
    label: "No giving recorded",
    blocked: "Counting attendance but keeping the offering somewhere else.",
  },
  message: {
    label: "Never messaged anyone",
    blocked: "Has the data in, but has not used it to reach anybody yet.",
  },
};

export type ActivationRow = {
  churchId: string;
  name: string;
  slug: string;
  plan: string;
  health: ChurchHealth;
  createdAt: Date;
  daysSinceSignup: number;
  lastSeenAt: Date | null;
  memberCount: number;
  funnel: FunnelFlags;
  funnelCompleted: number;
  /** The first step not done — the thing standing between them and using it. */
  stalledAt: FunnelStep | null;
  stalledLabel: string;
  stalledDetail: string;
};

const DAY_MS = 86_400_000;

/**
 * The first incomplete step, not the furthest complete one.
 *
 * The steps are ordered by dependency: a church cannot record a service before
 * it has anybody to record. So the earliest gap is the one actually blocking
 * them, and jumping to a later empty step would suggest a fix they cannot apply
 * yet.
 */
export function firstGap(flags: FunnelFlags): FunnelStep | null {
  return FUNNEL_STEPS.find((step) => !flags[step]) ?? null;
}

export type ActivationBoard = {
  /** Signed up, never started. The ones this board exists for. */
  stalled: ActivationRow[];
  /** Started, then went quiet — a different conversation. */
  slipping: ActivationRow[];
  healthyCount: number;
  totalChurches: number;
  sample: Sample;
};

function toRow(r: Awaited<ReturnType<typeof getChurchHealth>>[number], now: Date): ActivationRow {
  const stalledAt = firstGap(r.funnel);
  return {
    churchId: r.churchId,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    health: r.health,
    createdAt: r.createdAt,
    daysSinceSignup: Math.floor((now.getTime() - r.createdAt.getTime()) / DAY_MS),
    lastSeenAt: r.lastSeenAt,
    memberCount: r.memberCount,
    funnel: r.funnel,
    funnelCompleted: r.funnelCompleted,
    stalledAt,
    stalledLabel: stalledAt ? STEP_COPY[stalledAt].label : "Fully set up",
    stalledDetail: stalledAt
      ? STEP_COPY[stalledAt].blocked
      : "Every onboarding step is done.",
  };
}

export async function getActivationBoard(): Promise<ActivationBoard> {
  const rows = await getChurchHealth();
  const now = new Date();

  const mapped = rows.map((r) => toRow(r, now));

  // Longest silence first: the ones most likely to be gone, and the ones whose
  // signup is still recent enough to be worth a call are furthest from that.
  const stalled = mapped
    .filter((r) => r.health === "never_activated")
    .sort((a, b) => b.daysSinceSignup - a.daysSinceSignup);

  const slipping = mapped
    .filter((r) => r.health === "at_risk" || r.health === "dormant")
    .sort((a, b) => {
      const at = a.lastSeenAt?.getTime() ?? 0;
      const bt = b.lastSeenAt?.getTime() ?? 0;
      return at - bt;
    });

  return {
    stalled,
    slipping,
    healthyCount: mapped.filter((r) => r.health === "healthy").length,
    totalChurches: mapped.length,
    sample: { n: mapped.length, churches: mapped.length, unit: "churches" },
  };
}
