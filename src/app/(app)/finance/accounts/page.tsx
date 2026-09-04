import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import {
  listAccounts,
  listTransfers,
  transferableAccounts,
} from "@/lib/finance-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AccountsManager } from "@/components/finance/accounts-manager";
import { TransfersManager } from "@/components/finance/transfers-manager";

export const metadata = { title: "Finance accounts" };

export default async function FinanceAccountsPage() {
  const { church } = await requireChurch();
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [accounts, transfers, movable] = await Promise.all([
    listAccounts(church.id),
    listTransfers(church.id),
    transferableAccounts(church.id),
  ]);

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
      <div className="space-y-10">
        <AccountsManager
          canManage={canManage}
          currency={church.currency}
          accounts={accounts}
        />
        <TransfersManager
          canManage={canManage}
          currency={church.currency}
          accounts={movable}
          transfers={transfers}
          today={today}
        />
      </div>
    </PageContainer>
  );
}
