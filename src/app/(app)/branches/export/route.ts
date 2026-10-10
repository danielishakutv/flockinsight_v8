import { requireChurch } from "@/lib/session";
import { requireCanAny } from "@/lib/permissions";
import { branchStats, rollUp } from "@/lib/branches";
import { parseBranchFilters, rangeLabel } from "@/lib/branches-shared";
import { toCsv, CSV_BOM } from "@/lib/csv";
import { slugify } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /branches/export?range=…&zone=… -> the branch roll-up as a spreadsheet,
// matching whatever filters the dashboard is showing.
export async function GET(request: Request) {
  const { church } = await requireChurch();
  await requireCanAny(["settings.manage", "analytics.view"]);

  const url = new URL(request.url);
  const filters = parseBranchFilters(Object.fromEntries(url.searchParams));
  const { rows } = await branchStats(church.id, filters);
  const totals = rollUp(rows);
  /*
   * Naira and pounds added together and printed with one symbol is a figure
   * that is not true in either currency. Left blank and said so, rather than
   * quietly wrong — the per-branch rows above each carry their own currency
   * and remain exact.
   */
  const mixedCurrency =
    new Set(rows.map((r) => r.currency).filter(Boolean)).size > 1;

  /*
   * The group comes before the free-text zone, because that is the column a
   * network sorts and pivots on. It carries the whole path — "Nigeria · North
   * Central · Jos District" — so a spreadsheet can be grouped at any level
   * without having to know this platform's tree.
   */
  const csv = toCsv([
    ["Branch", "Group", "Zone", "City", "State", "Country", "Members", "New members", "Services", "Total attendance", "Average attendance", "Giving", "Currency", "Last recorded"],
    ...rows.map((r) => [
      r.name,
      r.bandPath,
      r.zone ?? "",
      r.city ?? "",
      r.state ?? "",
      r.country,
      r.members,
      r.newMembers,
      r.services,
      r.attendanceTotal,
      r.attendanceAvg,
      r.giving,
      r.currency,
      r.lastActivity ?? "",
    ]),
    [],
    [
      `Total (${rangeLabel(filters.range)})`,
      "",
      "",
      "",
      "",
      "",
      totals.members,
      totals.newMembers,
      totals.services,
      totals.attendanceTotal,
      totals.services ? Math.round(totals.attendanceTotal / totals.services) : 0,
      mixedCurrency ? "" : totals.giving,
      mixedCurrency ? "mixed" : church.currency,
      mixedCurrency ? "Branches report in more than one currency, so this is left blank" : "",
    ],
  ]);

  const date = new Date().toISOString().slice(0, 10);
  const name = slugify(church.name) || "church";
  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-branches-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
