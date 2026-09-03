import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { FINANCE_CSV_HEADERS, getFinanceExportRows } from "@/lib/finance-data";
import { readFinanceFilters } from "@/lib/finance-shared";

// GET /finance/export → the current view as CSV.
//
// It honours the same filters as the page, so what downloads is what was on
// screen. Without them a treasurer asking for "last quarter's expenses" would
// get the whole ledger and have to sort it out in a spreadsheet.
export async function GET(request: Request) {
  const { church } = await requireChurch();
  // A route handler is a separate entry point from the page, so the permission
  // is checked here too rather than assumed from having reached the link.
  if (!(await can("finance.view"))) {
    return new Response("Not allowed", { status: 403 });
  }

  const url = new URL(request.url);
  const filters = readFinanceFilters((k) => url.searchParams.get(k));

  const rows = await getFinanceExportRows(church.id, filters);
  const csv = CSV_BOM + toCsv([[...FINANCE_CSV_HEADERS], ...rows]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${church.slug}-finance-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
