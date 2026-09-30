import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listCategories } from "@/lib/finance-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { CategoriesManager } from "@/components/finance/categories-manager";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Finance categories" };

export default async function FinanceCategoriesPage() {
  const t = await getT();
  const { church } = await requireChurch();
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const categories = await listCategories(church.id);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/finance">
          <ArrowLeft className="size-4" />
          Finance
        </Link>
      </Button>
      <PageHeader
        title={t("finance.categories")}
        description={t("finance.whatIncomeAndSpendingIs")}
      />
      <CategoriesManager
        canManage={canManage}
        currency={church.currency}
        categories={categories}
      />
    </PageContainer>
  );
}
