import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { canDownload, getDataset } from "@/lib/report-catalog";
import { buildDataset } from "@/lib/report-data";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { parseRange, rangeSuffix } from "@/lib/report-range";

/**
 * One dataset, as CSV or PDF.
 *
 *   GET /reports/download/members?format=csv&from=2026-01-01&to=2026-03-31
 *
 * The permission is re-checked here rather than trusted from the page: a
 * download URL is guessable, and hiding a card is not access control.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const { dataset: id } = await params;
  const { church } = await requireChurch();

  const dataset = getDataset(id);
  if (!dataset) return new Response("Unknown report.", { status: 404 });

  const access = await getAccess();
  if (!canDownload(dataset, [...access.perms], access.isOwner))
    return new Response("You don't have permission to download this report.", {
      status: 403,
    });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const range = parseRange(url.searchParams);

  const data = await buildDataset(dataset.id, church.id, range);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${church.slug}-${dataset.id}${rangeSuffix(range)}-${stamp}`;

  if (format === "pdf") {
    const { renderDatasetPdf } = await import("@/lib/report-pdf");
    const pdf = await renderDatasetPdf({
      churchName: church.name,
      dataset,
      data,
      range,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = CSV_BOM + toCsv([data.columns, ...data.rows]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
