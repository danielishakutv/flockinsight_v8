import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { BASE_STORAGE_BYTES } from "@/lib/storage-bytes";

/** Effective storage limit for a church = free base + purchased extra. */
export function storageLimitBytes(extraBytes: number): number {
  return BASE_STORAGE_BYTES + Math.max(0, extraBytes || 0);
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
  const limit = storageLimitBytes(extraBytes);
  return {
    used,
    limit,
    extra: Math.max(0, extraBytes || 0),
    free: Math.max(0, limit - used),
    pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
  };
}
