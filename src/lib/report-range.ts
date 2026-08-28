/**
 * Reading and labelling the `from`/`to` date range that every report accepts.
 *
 * Kept apart from `report-data` so the client page can format a range without
 * dragging the whole DB layer into the bundle.
 */

/** An inclusive date window. `null` on either side means "unbounded". */
export type ReportRange = { from: string | null; to: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function clean(v: string | null): string | null {
  if (!v || !ISO_DATE.test(v)) return null;
  // Reject a well-formed but impossible date like 2026-02-31, which Postgres
  // would throw on rather than quietly ignore.
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : v;
}

export function parseRange(params: URLSearchParams): ReportRange {
  const from = clean(params.get("from"));
  const to = clean(params.get("to"));
  // A backwards range would silently return nothing; swap it instead, which is
  // what the person obviously meant.
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

/** `-2026-01-01_2026-03-31`, or empty for an unfiltered export. */
export function rangeSuffix(range: ReportRange): string {
  if (!range.from && !range.to) return "";
  return `-${range.from ?? "start"}_${range.to ?? "today"}`;
}

/** Human label for a range, for headers and filenames. */
export function rangeLabel(range: ReportRange): string {
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `From ${range.from}`;
  if (range.to) return `Up to ${range.to}`;
  return "All time";
}

/** Turn a range back into query-string form, omitting empty parts. */
export function rangeQuery(range: ReportRange): string {
  const p = new URLSearchParams();
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  const s = p.toString();
  return s ? `&${s}` : "";
}
