import { eq } from "drizzle-orm";
import { db } from "@/db";
import { financeTransaction } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import {
  activeAccountOptions,
  activeCategoryOptions,
  FINANCE_PAGE_SIZE,
  getFinanceSummary,
  getLedger,
} from "@/lib/finance-data";
import { readFinanceFilters } from "@/lib/finance-shared";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { FinanceClient } from "@/components/finance/finance-client";

export const metadata = { title: "Finance" };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church } = await requireChurch();
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const sp = await searchParams;
  const first = (key: string) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters = readFinanceFilters(first);
  const page = Math.max(1, Number(first("page") ?? 1) || 1);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [accounts, categories, ledger, summary, [anyRow]] = await Promise.all([
    activeAccountOptions(church.id),
    activeCategoryOptions(church.id),
    getLedger(church.id, filters, page),
    // The summary follows the same range the person is looking at, so the
    // cards and the list below can never tell two different stories.
    getFinanceSummary(church.id, filters.from, filters.to),
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
      <PageHeader
        title="Finance"
        description="What came in, what went out, and what each account holds."
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
        page={page}
        pageSize={FINANCE_PAGE_SIZE}
        hasAnyRecords={Boolean(anyRow)}
        hasAnyAccounts={accounts.length > 0}
      />
    </PageContainer>
  );
}
