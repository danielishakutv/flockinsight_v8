import "server-only";
import { unstable_cache } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, usageStat } from "@/db/schema";
import {
  coverageRatio,
  dailyBurnFromSnapshots,
  deriveUnitCost,
  marginFor,
  runwayDays,
  smsLiabilityPages,
} from "@/lib/float-math";
import {
  getRunwayThresholds,
  getSmsPrice,
  getTermiiUnitCost,
  getUnitCostMode,
  type UnitCostMode,
} from "@/lib/platform-settings";
import {
  consecutiveFailures,
  isTermiiConfigured,
  latestSuccessfulSnapshot,
  recentSnapshots,
  type SnapshotRow,
} from "@/lib/termii-balance";

/**
 * The float: how much credit is left at Termii, how long it lasts, and whether
 * it can cover the SMS churches have already paid for.
 *
 * Composes pure maths (float-math.ts) with live data. Everything that could be
 * unknown is typed `| null` rather than defaulted to zero — a funding
 * dashboard that guesses is a funding dashboard that lets you run dry.
 */

const BURN_WINDOW_DAYS = 7;
const UNIT_COST_WINDOW_DAYS = 14;
const STALE_AFTER_MS = 60 * 60 * 1000;

export type FloatOverview = {
  configured: boolean;
  balance: number | null;
  currency: string;
  fetchedAt: Date | null;
  /** Newest successful reading is over an hour old. */
  stale: boolean;
  consecutiveFailures: number;
  dailyBurn: number | null;
  runwayDays: number | null;
  coverage: number | null;
  liabilityPages: number;
  liabilityValue: number;
  unitCost: number | null;
  unitCostMode: UnitCostMode;
  unitCostIsEstimated: boolean;
  smsPrice: number;
  pagesMonth: number;
  pagesAllTime: number;
  marginMonth: number | null;
  marginAllTime: number | null;
  thresholds: { warn: number; critical: number };
  history: { fetchedAt: Date; balance: number }[];
};

function startOfMonthDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Total SMS pages sold across the platform, optionally since a day. */
async function pagesSold(sinceDay?: string): Promise<number> {
  const where = sinceDay
    ? and(eq(usageStat.metric, "sms_pages"), gte(usageStat.day, sinceDay))
    : eq(usageStat.metric, "sms_pages");
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageStat.count}), 0)` })
    .from(usageStat)
    .where(where);
  return Number(row?.total ?? 0);
}

/**
 * SMS pages every church has paid for and not yet sent. Wallets are unified
 * across SMS and storage, so storage each church is already committed to is
 * excluded before the rest counts as SMS credit.
 */
async function totalLiabilityPages(smsPrice: number, now: Date): Promise<number> {
  const rows = await db
    .select({
      walletBalance: church.walletBalance,
      storageMonthlyCost: church.storageMonthlyCost,
      storageRenewsAt: church.storageRenewsAt,
    })
    .from(church)
    .where(eq(church.status, "active"));

  return rows.reduce(
    (total, r) =>
      total +
      smsLiabilityPages({
        walletBalance: Number(r.walletBalance),
        storageMonthlyCost: Number(r.storageMonthlyCost),
        storageRenewsAt: r.storageRenewsAt,
        smsPrice,
        now,
      }),
    0,
  );
}

/** Total drawdown observed across a snapshot series (decreases only). */
function totalDrawdown(snapshots: SnapshotRow[]): number {
  const usable = snapshots
    .filter((s): s is SnapshotRow & { balance: number } => s.balance !== null)
    .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  let drop = 0;
  for (let i = 1; i < usable.length; i++) {
    const delta = usable[i - 1].balance - usable[i].balance;
    if (delta > 0) drop += delta;
  }
  return drop;
}

async function buildFloatOverview(): Promise<FloatOverview> {
  const now = new Date();
  const monthStart = startOfMonthDay(now);

  const [
    smsPrice,
    configuredUnitCost,
    unitCostMode,
    thresholds,
    latest,
    history30,
    failures,
    pagesMonth,
    pagesAllTime,
  ] = await Promise.all([
    getSmsPrice(),
    getTermiiUnitCost(),
    getUnitCostMode(),
    getRunwayThresholds(),
    latestSuccessfulSnapshot(),
    recentSnapshots(30),
    consecutiveFailures(),
    pagesSold(monthStart),
    pagesSold(),
  ]);

  const liabilityPages = await totalLiabilityPages(smsPrice, now);

  // Burn from real balance deltas — that also captures any sending done on this
  // Termii account outside FlockInsight.
  const burnWindow = history30.filter(
    (s) => s.fetchedAt.getTime() >= now.getTime() - BURN_WINDOW_DAYS * 86_400_000,
  );
  const dailyBurn = dailyBurnFromSnapshots(burnWindow, BURN_WINDOW_DAYS);

  // Auto mode derives cost from observed drawdown per page; it needs history,
  // so it falls back to the configured value whenever the guards reject.
  let unitCost = configuredUnitCost;
  let unitCostIsEstimated = false;
  if (unitCostMode === "auto") {
    const costWindow = history30.filter(
      (s) =>
        s.fetchedAt.getTime() >= now.getTime() - UNIT_COST_WINDOW_DAYS * 86_400_000,
    );
    const windowStart = `${new Date(now.getTime() - UNIT_COST_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10)}`;
    const windowPages = await pagesSold(windowStart);
    const derived = deriveUnitCost({
      drawdown: totalDrawdown(costWindow),
      pages: windowPages,
    });
    if (derived !== null) {
      unitCost = derived;
      unitCostIsEstimated = true;
    }
  }

  const balance = latest?.balance ?? null;
  const stale =
    latest === null || now.getTime() - latest.fetchedAt.getTime() > STALE_AFTER_MS;

  return {
    configured: isTermiiConfigured(),
    balance,
    currency: latest?.currency ?? "NGN",
    fetchedAt: latest?.fetchedAt ?? null,
    stale,
    consecutiveFailures: failures,
    dailyBurn,
    runwayDays:
      balance === null || dailyBurn === null
        ? null
        : runwayDays({ balance, dailyBurn }),
    coverage:
      balance === null || unitCost === null
        ? null
        : coverageRatio({ balance, liabilityPages, unitCost }),
    liabilityPages,
    liabilityValue: unitCost === null ? 0 : +(liabilityPages * unitCost).toFixed(2),
    unitCost,
    unitCostMode,
    unitCostIsEstimated,
    smsPrice,
    pagesMonth,
    pagesAllTime,
    marginMonth:
      unitCost === null ? null : marginFor({ pages: pagesMonth, smsPrice, unitCost }),
    marginAllTime:
      unitCost === null
        ? null
        : marginFor({ pages: pagesAllTime, smsPrice, unitCost }),
    thresholds,
    history: history30
      .filter((s): s is SnapshotRow & { balance: number } => s.balance !== null)
      .map((s) => ({ fetchedAt: s.fetchedAt, balance: s.balance })),
  };
}

/**
 * Cached for 5 minutes and tagged so the Refresh button can bust it on demand
 * via `revalidateTag("float")`.
 */
export const getFloatOverview = unstable_cache(
  buildFloatOverview,
  ["float-overview"],
  { revalidate: 300, tags: ["float"] },
);

/** Uncached — used by the alert cron, which must never act on stale numbers. */
export const getFloatOverviewFresh = buildFloatOverview;
