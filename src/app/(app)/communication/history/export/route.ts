import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import {
  HISTORY_CSV_HEADERS,
  getHistoryExportRows,
} from "@/lib/comm-history";
import { parseHistoryFilters } from "@/lib/comm-history-shared";
import { CSV_BOM, toCsv } from "@/lib/csv";

// GET /communication/history/export?channel=&range=&q= → the filtered log as CSV
export async function GET(request: Request) {
  const { church } = await requireChurch();
  await requireCan("communication.view");

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseHistoryFilters(params);
  const rows = await getHistoryExportRows(church.id, filters);

  const csv = CSV_BOM + toCsv([[...HISTORY_CSV_HEADERS], ...rows]);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${church.slug}-messages-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
