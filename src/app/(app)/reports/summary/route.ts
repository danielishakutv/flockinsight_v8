import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { allowedDatasets } from "@/lib/report-catalog";
import { getChurchTotals, getDatasetCounts } from "@/lib/report-data";
import { formatMoney } from "@/lib/money";
import { parseRange, rangeSuffix } from "@/lib/report-range";
import { renderSummaryPdf } from "@/lib/report-pdf";

/**
 * The cover report: headline numbers plus a guide to every dataset and how the
 * files join. One PDF you can hand to a board or a trustee.
 *
 *   GET /reports/summary?from=2026-01-01&to=2026-03-31
 */
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const access = await getAccess();
  const datasets = allowedDatasets([...access.perms], access.isOwner);

  if (datasets.length === 0)
    return new Response("You don't have permission to download any reports.", {
      status: 403,
    });

  const range = parseRange(new URL(request.url).searchParams);

  // Row counts are what make the summary honest — "0 rows" tells a reader that
  // a module is empty rather than leaving them to assume it failed.
  const [totals, counts] = await Promise.all([
    getChurchTotals(church.id),
    getDatasetCounts(church.id),
  ]);

  const pdf = await renderSummaryPdf({
    churchName: church.name,
    totals,
    datasets,
    counts,
    range,
    money: (n) => formatMoney(n, totals.currency),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${church.slug}-data-report${rangeSuffix(range)}-${stamp}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
