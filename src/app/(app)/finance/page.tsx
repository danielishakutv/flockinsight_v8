import { eq } from "drizzle-orm";
import { db } from "@/db";
import { financeTransaction } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import {
  activeCategoryOptions,
  FINANCE_PAGE_SIZE,
  getFinanceSummary,
  getLedger,
  transferableAccounts,
} from "@/lib/finance-data";
import { EMPTY_FINANCE_FILTERS, readFinanceFilters } from "@/lib/finance-shared";
import { churchToday } from "@/lib/church-today";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FinanceClient } from "@/components/finance/finance-client";
import { getT } from "@/lib/i18n/server";
import { PlanGate } from "@/components/app/plan-gate";

export const metadata = { title: "Finance" };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const sp = await searchParams;
  const first = (key: string) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters = readFinanceFilters(first);
  const page = Math.max(1, Number(first("page") ?? 1) || 1);

  // The church's own today, not the server's: it is the default date of a new
  // entry and the anchor of "This month" / "This year".
  const today = churchToday(church.timezone);

  const [accounts, categories, ledger, summary, [anyRow]] = await Promise.all([
    // Carries the giving link, so the form knows which accounts may take
    // income by hand and which are fed by giving alone.
    transferableAccounts(church.id),
    activeCategoryOptions(church.id),
    getLedger(church.id, filters, page),
    // The cards follow the date range the person is looking at. The other
    // filters narrow the list, and the "in / out" line beside its count comes
    // from the ledger's own totals, so it describes the results it sits next to.
    getFinanceSummary(church.id, {
      ...EMPTY_FINANCE_FILTERS,
      from: filters.from,
      to: filters.to,
    }),
    // "No records yet" and "nothing matches these filters" need different
    // words, so ask whether anything exists at all.
    db
      .select({ id: financeTransaction.id })
      .from(financeTransaction)
      .where(eq(financeTransaction.churchId, church.id))
      .limit(1),
  ]);

  return (
    <PageContainer>
      <PlanGate feature="finance" />

      <PageHeader
        title={t("finance.title")}
        description={t("finance.subtitle")}
      />
      <FinanceClient
        canManage={canManage}
        currency={church.currency}
        accounts={accounts}
        categories={categories}
        rows={ledger.rows}
        today={today}
        summary={summary}
        filters={filters}
        resultCount={ledger.count}
        resultIncome={ledger.income}
        resultExpense={ledger.expense}
        page={page}
        pageSize={FINANCE_PAGE_SIZE}
        hasAnyRecords={Boolean(anyRow)}
        hasAnyAccounts={accounts.length > 0}
      />
    </PageContainer>
  );
}
