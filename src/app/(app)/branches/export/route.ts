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

  const csv = toCsv([
    ["Branch", "Zone", "City", "State", "Country", "Members", "New members", "Services", "Total attendance", "Average attendance", "Giving", "Currency", "Last recorded"],
    ...rows.map((r) => [
      r.name,
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
      totals.members,
      totals.newMembers,
      totals.services,
      totals.attendanceTotal,
      totals.services ? Math.round(totals.attendanceTotal / totals.services) : 0,
      totals.giving,
      church.currency,
      "",
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
