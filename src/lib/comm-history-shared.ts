// Pure filter vocabulary for the message history screen — safe to import from
// client OR server components. The DB queries live in lib/comm-history.ts.

export const HISTORY_RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
  { id: "all", label: "All time", days: null },
] as const;
export type RangeId = (typeof HISTORY_RANGES)[number]["id"];

export const HISTORY_CHANNELS = [
  { id: "all", label: "All channels" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "notification", label: "Staff notices" },
] as const;
export type ChannelId = (typeof HISTORY_CHANNELS)[number]["id"];

export const PAGE_SIZE = 25;

export type HistoryFilters = {
  channel: ChannelId;
  range: RangeId;
  q: string;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Read (and sanitise) the filters from the URL. Bad values fall back. */
export function parseHistoryFilters(sp: RawParams): HistoryFilters {
  const channel = first(sp.channel) as ChannelId;
  const range = first(sp.range) as RangeId;
  const page = Number(first(sp.page));
  return {
    channel: HISTORY_CHANNELS.some((c) => c.id === channel) ? channel : "all",
    range: HISTORY_RANGES.some((r) => r.id === range) ? range : "30",
    q: first(sp.q).trim().slice(0, 80),
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
  };
}

/**
 * Serialise filters back into a query string. Defaults (all channels, 30 days,
 * page 1) are left out so the common URL stays clean.
 */
export function historyQuery(
  f: HistoryFilters,
  overrides: Partial<HistoryFilters> = {},
): string {
  const merged = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (merged.channel !== "all") p.set("channel", merged.channel);
  if (merged.range !== "30") p.set("range", merged.range);
  if (merged.q) p.set("q", merged.q);
  if (merged.page > 1) p.set("page", String(merged.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The first instant included by a range filter, or null for "all time". */
export function rangeStart(range: RangeId): Date | null {
  const days = HISTORY_RANGES.find((r) => r.id === range)?.days ?? null;
  if (days === null) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** How wide the activity-chart buckets should be for a given range. */
export function bucketUnit(range: RangeId): "day" | "week" | "month" {
  const days = HISTORY_RANGES.find((r) => r.id === range)?.days ?? null;
  if (days === null || days > 365) return "month";
  return days > 31 ? "week" : "day";
}
