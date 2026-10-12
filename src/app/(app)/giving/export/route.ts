import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { CSV_BOM, toCsv } from "@/lib/csv";
import {
  GIVING_CSV_HEADERS,
  GIVING_CSV_SAMPLE,
  getGivingExportRows,
  parseGivingFilters,
} from "@/lib/giving-data";

// GET /giving/export            → all giving as CSV
// GET /giving/export?template=1 → header row + one example row (import guide)
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const url = new URL(request.url);
  const isTemplate = url.searchParams.get("template") === "1";
  /*
   * A route handler is its own entry point: no page guard or layout runs before
   * it, so the permission is checked here. 403, not a redirect — a redirect
   * inside a download saves the sign-in page as a .csv. The template carries
   * only the sample row, so it needs no permission.
   */
  if (!isTemplate && !(await can("giving.view"))) {
    return new Response("You don't have permission to export giving.", {
      status: 403,
    });
  }

  const header = [...GIVING_CSV_HEADERS];
  // The list's own filters, so the file holds what was on screen. With none
  // in the URL every gift is exported, exactly as before.
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const body = isTemplate
    ? [GIVING_CSV_SAMPLE]
    : await getGivingExportRows(church.id, parseGivingFilters(params));

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
