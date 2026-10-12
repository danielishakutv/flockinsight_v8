import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  getFinanceSummary,
  getLedger,
  listAccounts,
  listCategories,
} from "@/lib/finance-data";
import { FINANCE_FILTER_NONE, KIND_LABEL, readFinanceFilters } from "@/lib/finance-shared";
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

  const [brand, summary, accounts, categories, ledger] = await Promise.all([
    getChurchBrand(church),
    // Every filter, not only the dates: the headline cards and the category
    // table describe exactly the rows listed under them.
    getFinanceSummary(church.id, filters),
    listAccounts(church.id),
    listCategories(church.id),
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

  // Say on the statement that it is filtered, and by what, so a reader can
  // never take a "Rent only" statement for the church's whole books.
  const nameOf = (list: { id: string; name: string }[], id: string, none: string) =>
    id === FINANCE_FILTER_NONE ? none : (list.find((x) => x.id === id)?.name ?? "an account no longer listed");
  const filterParts: string[] = [];
  if (filters.kind === "income" || filters.kind === "expense") {
    filterParts.push(KIND_LABEL[filters.kind]);
  }
  if (filters.accountId) {
    filterParts.push(`Account: ${nameOf(accounts, filters.accountId, "no account")}`);
  }
  if (filters.categoryId) {
    filterParts.push(`Category: ${nameOf(categories, filters.categoryId, "uncategorised")}`);
  }
  if (filters.method) filterParts.push(`Method: ${filters.method}`);
  if (filters.q) filterParts.push(`Search: "${filters.q.slice(0, 60)}"`);
  const filterLabel = filterParts.length ? filterParts.join(" · ") : null;

  const pdf = await renderFinancePdf({
    brand,
    currency: church.currency,
    summary,
    accounts,
    rows: ledger.rows,
    totalRows: ledger.count,
    rangeLabel,
    filterLabel,
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
