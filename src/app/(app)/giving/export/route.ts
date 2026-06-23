import { requireChurch } from "@/lib/session";
import { CSV_BOM, toCsv } from "@/lib/csv";
import {
  GIVING_CSV_HEADERS,
  GIVING_CSV_SAMPLE,
  getGivingExportRows,
} from "@/lib/giving-data";

// GET /giving/export            → all giving as CSV
// GET /giving/export?template=1 → header row + one example row (import guide)
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const isTemplate = new URL(request.url).searchParams.get("template") === "1";

  const header = [...GIVING_CSV_HEADERS];
  const body = isTemplate
    ? [GIVING_CSV_SAMPLE]
    : await getGivingExportRows(church.id);

  const csv = CSV_BOM + toCsv([header, ...body]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = isTemplate
    ? "giving-import-template.csv"
    : `${church.slug}-giving-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
