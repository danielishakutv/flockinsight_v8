import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { getChurchBrand } from "@/lib/pdf-brand";
import { getAccess } from "@/lib/permissions";
import { summaryRefusal } from "@/lib/report-summary-access";
import { allowedDatasets } from "@/lib/report-catalog";
import { getChurchTotals, getDatasetCounts } from "@/lib/report-data";
import { getSummaryInsights } from "@/lib/report-summary";
import { formatMoney } from "@/lib/money";
import { parseRange, rangeSuffix } from "@/lib/report-range";
import { renderSummaryPdf } from "@/lib/report-pdf";

/**
 * The data report: a church's own figures for a period — giving by category,
 * attendance by service, month by month, the roll, the groups, what the
 * messages cost — and a closing list of what else is on file.
 *
 * One PDF you can hand to a board or a trustee. It used to be a data
 * dictionary instead, which is why `lib/report-summary.ts` exists.
 *
 *   GET /reports/summary?from=2026-01-01&to=2026-03-31
 */
export async function GET(request: Request) {
  const { church } = await requireChurch();
  /*
   * The reports centre is sold from Pro, and THIS is where the data actually
   * leaves — a gate on the page would be decoration while the download URL
   * still worked for anybody who had it.
   */
  const gate = await refuseWithoutFeature("reports");
  if (gate) return new Response(gate.error, { status: 403 });
  const access = await getAccess();
  const datasets = allowedDatasets([...access.perms], access.isOwner);

  if (datasets.length === 0)
    return new Response("You don't have permission to download any reports.", {
      status: 403,
    });

  /*
   * This report prints every module's figures, not just the datasets above:
   * total giving, giving by category and month, what the messages cost, the
   * roll and the groups. `datasets` only ever filtered the closing list, so a
   * volunteer with members.view alone (the default Member role) downloaded the
   * church's giving — the thing a church writes a narrow role to withhold.
   *
   * Until the PDF can leave out the sections a person may not see (and say
   * that it did, so an omitted section never reads as "nothing recorded"), it
   * is all or nothing: the view permission for every module it prints.
   * The rule lives in lib/report-summary-access.ts so the Reports page can
   * disable its button with the same sentence.
   */
  const refused = summaryRefusal(access.isOwner, access.perms);
  if (refused) return new Response(refused, { status: 403 });

  const range = parseRange(new URL(request.url).searchParams);

  /*
   * Three reads, in parallel, because they answer three different questions.
   *
   *  - `totals` are the headline tiles.
   *  - `insights` are the figures the report is actually made of: giving by
   *    category, attendance by service, the monthly series, the roll, the
   *    groups, what the messages cost.
   *  - `counts` are the closing list. They exist so a reader can tell an empty
   *    module from a broken one — "nothing recorded" beats a silent gap.
   */
  const [totals, insights, counts] = await Promise.all([
    getChurchTotals(church.id, range),
    getSummaryInsights(church.id, range),
    getDatasetCounts(church.id),
  ]);

  const pdf = await renderSummaryPdf({
    brand: await getChurchBrand(church),
    totals,
    insights,
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
