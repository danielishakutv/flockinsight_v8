import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, media } from "@/db/schema";
import { planStorageBytes } from "@/lib/storage-bytes";

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

  const limit = storageLimitBytes(extraBytes, row?.plan);
  return {
    used,
    limit,
    extra: Math.max(0, extraBytes || 0),
    free: Math.max(0, limit - used),
    pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
  };
}
