// Pure storage helpers + constants — safe to import from client OR server.

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/**
 * Included storage, per plan.
 *
 * This used to be one number for everybody, which meant a Pro church paying
 * ₦15,000 a month got exactly the same 200 MB as a free Starter — the single
 * biggest hole in the unit economics, because storage is the cost that never
 * goes away. Cloudinary bills roughly a credit per gigabyte stored per month
 * and the jump from the free 25 credits to the next tier is $99, so what each
 * plan may keep is the main thing standing between this platform and a bill
 * larger than its revenue.
 *
 * Deliberately modest. A church's photos, logos and documents are small; it is
 * VIDEO that fills a quota, and video is what a paid plan is really buying.
 */
export const PLAN_STORAGE_BYTES: Record<string, number> = {
  starter: 200 * MB,
  growth: 500 * MB,
  pro: 2 * GB,
  enterprise: 20 * GB,
};

/** What a plan we do not recognise gets. The smallest, on purpose. */
export const BASE_STORAGE_BYTES = 200 * MB;

export function planStorageBytes(plan: string | null | undefined): number {
  return PLAN_STORAGE_BYTES[plan ?? ""] ?? BASE_STORAGE_BYTES;
}

/** Human-readable size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(n: number, decimals = 1): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/**
 * A paid storage add-on: `gb` extra gigabytes for `price` per month, billed
 * from the church wallet. Admin-editable (see lib/pricing.ts). The defaults
 * below are placeholders until the platform operator sets real numbers.
 */
export type StorageBundle = { gb: number; price: number };

export const DEFAULT_STORAGE_BUNDLES: StorageBundle[] = [
  { gb: 1, price: 1200 },
  { gb: 5, price: 5500 },
  { gb: 10, price: 9500 },
];
