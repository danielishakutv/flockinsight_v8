// Pure filter vocabulary for one message's recipient list — safe to import
// from client OR server components. The DB queries live in lib/comm-message.ts.
// Mirrors the comm-history / comm-history-shared split.

export const RECIPIENT_PAGE_SIZE = 100;

/** The status tabs on the message detail screen. */
export const RECIPIENT_STATUS_FILTERS = [
  { id: "all", label: "Everyone" },
  { id: "failed", label: "Not delivered" },
  { id: "sent", label: "Delivered" },
  { id: "skipped", label: "Skipped" },
] as const;
export type RecipientStatusFilter =
  (typeof RECIPIENT_STATUS_FILTERS)[number]["id"];

export type MessageFilters = {
  status: RecipientStatusFilter;
  q: string;
  page: number;
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Read (and sanitise) the filters from the URL. Bad values fall back. */
export function parseMessageFilters(
  sp: Record<string, string | string[] | undefined>,
): MessageFilters {
  const status = first(sp.status) as RecipientStatusFilter;
  const page = Number(first(sp.page));
  return {
    status: RECIPIENT_STATUS_FILTERS.some((s) => s.id === status)
      ? status
      : "all",
    q: first(sp.q).trim().slice(0, 80),
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
  };
}

/** Serialise filters back into a query string, omitting the defaults. */
export function messageQuery(
  f: MessageFilters,
  overrides: Partial<MessageFilters> = {},
): string {
  const m = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (m.status !== "all") p.set("status", m.status);
  if (m.q) p.set("q", m.q);
  if (m.page > 1) p.set("page", String(m.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
