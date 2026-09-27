import "server-only";
import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { church, meeting, meetingParticipant } from "@/db/schema";

/**
 * What meetings actually cost, measured rather than estimated.
 *
 * The numbers come from `getStats` in each participant's browser, reported on
 * the state push they already send. Estimating from a bitrate ladder and a
 * duration would be wrong precisely where it matters: a poor connection sends
 * less, a spotlight sends more, and a room where nobody turned a camera on
 * sends almost nothing. The figure that pays the bill should not be a model.
 *
 * WHAT IS BILLED. Cloudflare charges egress from its edge to a client, at
 * $0.05 a gigabyte with the first 1,000 GB free each month, and that free tier
 * is shared with TURN. So the number that costs money is what participants
 * RECEIVED — `bytesReceived` — and only on meetings that used the SFU. A mesh
 * meeting is peer-to-peer and costs nothing but the relay, which is inside the
 * same free tier.
 */

/** Dollars per gigabyte of egress, after the free tier. */
export const USD_PER_GB = 0.05;

/** Gigabytes included each month, shared between the SFU and TURN. */
export const FREE_GB_PER_MONTH = 1000;

const GB = 1024 ** 3;

export type UsageWindow = {
  /** Billable egress, in gigabytes. */
  gb: number;
  /** What is left of the free allowance. */
  freeRemainingGb: number;
  /** Dollars, after the free tier. */
  costUsd: number;
  meetings: number;
  participants: number;
  /** Minutes of meeting time, for the per-hour figures. */
  minutes: number;
};

export type ChurchUsage = {
  churchId: string;
  churchName: string;
  plan: string;
  gb: number;
  costUsd: number;
  meetings: number;
  participants: number;
};

function gigabytes(bytes: unknown): number {
  return Number(bytes ?? 0) / GB;
}

/** Cost for an amount of egress, given how much of the free tier is left. */
export function costFor(gb: number, freeRemainingGb = 0): number {
  const billable = Math.max(0, gb - Math.max(0, freeRemainingGb));
  return billable * USD_PER_GB;
}

/** The first moment of the current calendar month, in UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Platform-wide usage since `since`.
 *
 * Only SFU meetings count towards the bill. Mesh traffic goes directly between
 * browsers and is measured here too — it is worth knowing — but it is not
 * charged, so it is reported separately rather than folded in.
 */
export async function usageSince(since: Date): Promise<UsageWindow> {
  const [row] = await db
    .select({
      bytes: sum(meetingParticipant.bytesReceived),
      participants: count(meetingParticipant.id),
      minutes: sql<number>`coalesce(sum(${meetingParticipant.durationSec}) / 60.0, 0)`,
    })
    .from(meetingParticipant)
    .innerJoin(meeting, eq(meeting.id, meetingParticipant.meetingId))
    .where(and(gte(meetingParticipant.joinedAt, since), eq(meeting.transport, "sfu")));

  const [rooms] = await db
    .select({ n: count(meeting.id) })
    .from(meeting)
    .where(and(gte(meeting.createdAt, since), eq(meeting.transport, "sfu")));

  const gb = gigabytes(row?.bytes);
  const freeRemainingGb = Math.max(0, FREE_GB_PER_MONTH - gb);

  return {
    gb,
    freeRemainingGb,
    costUsd: costFor(gb, FREE_GB_PER_MONTH),
    meetings: Number(rooms?.n ?? 0),
    participants: Number(row?.participants ?? 0),
    minutes: Number(row?.minutes ?? 0),
  };
}

/**
 * Which churches are using it, most expensive first.
 *
 * Cost here is the marginal rate — what one more gigabyte costs — rather than
 * each church's share of a free tier that belongs to the platform. Splitting
 * a shared allowance between churches would produce a number that changes when
 * somebody else runs a meeting, which is not a thing anybody can act on.
 */
export async function usageByChurch(since: Date, limit = 20): Promise<ChurchUsage[]> {
  const rows = await db
    .select({
      churchId: church.id,
      churchName: church.name,
      plan: church.plan,
      bytes: sum(meetingParticipant.bytesReceived),
      participants: count(meetingParticipant.id),
      meetings: sql<number>`count(distinct ${meeting.id})`,
    })
    .from(meetingParticipant)
    .innerJoin(meeting, eq(meeting.id, meetingParticipant.meetingId))
    .innerJoin(church, eq(church.id, meeting.churchId))
    .where(and(gte(meetingParticipant.joinedAt, since), eq(meeting.transport, "sfu")))
    .groupBy(church.id, church.name, church.plan)
    .orderBy(desc(sum(meetingParticipant.bytesReceived)))
    .limit(limit);

  return rows.map((r) => {
    const gb = gigabytes(r.bytes);
    return {
      churchId: r.churchId,
      churchName: r.churchName,
      plan: r.plan,
      gb,
      costUsd: gb * USD_PER_GB,
      meetings: Number(r.meetings ?? 0),
      participants: Number(r.participants ?? 0),
    };
  });
}

/**
 * Where the month is heading, from how far into it we are.
 *
 * Straight-line, and deliberately so. A cleverer projection would need a
 * pattern to project, and church meetings are weekly rather than daily —
 * anything smarter would be confidently wrong every Monday.
 */
export function projectMonth(
  gbSoFar: number,
  now = new Date(),
): { gb: number; costUsd: number } {
  const start = monthStart(now);
  const daysIn = Math.max(
    1,
    (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const gb = (gbSoFar / daysIn) * daysInMonth;
  return { gb, costUsd: costFor(gb, FREE_GB_PER_MONTH) };
}
