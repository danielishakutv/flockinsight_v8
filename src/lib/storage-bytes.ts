// Pure storage helpers + constants — safe to import from client OR server.

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/** Free storage every church gets, before any paid add-on. */
export const BASE_STORAGE_BYTES = 200 * MB; // 200 MB

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
