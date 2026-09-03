import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listAccounts } from "@/lib/finance-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AccountsManager } from "@/components/finance/accounts-manager";

export const metadata = { title: "Finance accounts" };

export default async function FinanceAccountsPage() {
  const { church } = await requireChurch();
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const accounts = await listAccounts(church.id);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/finance">
          <ArrowLeft className="size-4" />
          Finance
        </Link>
      </Button>
      <PageHeader
        title="Accounts"
        description="Where the church's money sits. Balances are worked out from what you record, so they cannot go stale."
      />
      <AccountsManager
        canManage={canManage}
        currency={church.currency}
        accounts={accounts}
      />
    </PageContainer>
  );
}
