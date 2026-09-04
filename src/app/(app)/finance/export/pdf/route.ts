import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  getFinanceSummary,
  getLedger,
  listAccounts,
} from "@/lib/finance-data";
import { readFinanceFilters } from "@/lib/finance-shared";
import { getChurchBrand } from "@/lib/pdf-brand";
import { renderFinancePdf } from "@/lib/finance-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /finance/export/pdf → the current view as a printable statement.
//
// Honours the same filters as the page, so what prints is what was on screen.
export async function GET(request: Request) {
  const { church } = await requireChurch();
  // A route handler is its own entry point, so the permission is checked here
  // rather than assumed from having reached the link.
  if (!(await can("finance.view"))) {
    return new Response("Not allowed", { status: 403 });
  }

  const url = new URL(request.url);
  const filters = readFinanceFilters((k) => url.searchParams.get(k));

  const [brand, summary, accounts, ledger] = await Promise.all([
    getChurchBrand(church),
    getFinanceSummary(church.id, filters.from, filters.to),
    listAccounts(church.id),
    // One page of entries is not enough for a statement, so ask for a large
    // slice; the renderer caps what it prints and says so on the page.
    getLedger(church.id, filters, 1, 1000),
  ]);

  const rangeLabel =
    filters.from && filters.to
      ? `${filters.from} to ${filters.to}`
      : filters.from
        ? `From ${filters.from}`
        : filters.to
          ? `Until ${filters.to}`
          : "All time";

  const pdf = await renderFinancePdf({
    brand,
    currency: church.currency,
    summary,
    accounts,
    rows: ledger.rows,
    totalRows: ledger.count,
    rangeLabel,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${church.slug}-finance-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
