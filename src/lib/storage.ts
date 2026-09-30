import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, media } from "@/db/schema";
import { MB, planStorageBytes } from "@/lib/storage-bytes";
import type { PlanId } from "@/lib/plans";

/** Effective storage limit for a church = free base + purchased extra. */
export function storageLimitBytes(extraBytes: number, plan?: string | null): number {
  return planStorageBytes(plan) + Math.max(0, extraBytes || 0);
}

/** Total bytes a church is currently using (sum of all its media). */
export async function getStorageUsed(churchId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${media.bytes}), 0)` })
    .from(media)
    .where(eq(media.churchId, churchId));
  return Number(row?.used ?? 0);
}

export type StorageInfo = {
  used: number;
  limit: number;
  extra: number;
  free: number;
  pct: number;
};

/** Usage snapshot for a church, given its purchased extra bytes. */
export async function getStorageInfo(
  churchId: string,
  extraBytes: number,
): Promise<StorageInfo> {
  const used = await getStorageUsed(churchId);

  /*
   * The plan is read here rather than asked of every caller. Six places want a
   * storage figure — the media page, settings, two upload routes and the admin
   * — and a quota that depends on which of them asked is a quota that will
   * disagree with itself.
   */
  const [row] = await db
    .select({ plan: church.plan })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);

  /*
   * The admin's number wins over the one compiled in. Storage is the cost
   * that moves when a supplier changes their pricing, and the operator has to
   * be able to answer that from /superadmin/pricing rather than from a deploy.
   */
  const { getPlanStorageMb } = await import("@/lib/pricing");
  const mb = await getPlanStorageMb((row?.plan ?? "starter") as PlanId);
  const limit = mb * MB + Math.max(0, extraBytes || 0);
  return {
    used,
    limit,
    extra: Math.max(0, extraBytes || 0),
    free: Math.max(0, limit - used),
    pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
  };
}
