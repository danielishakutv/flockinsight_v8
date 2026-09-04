import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { financeAccount, giving, givingCategory } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getGivingReceiptSetting } from "@/lib/giving-receipts";
import { getPledgeReminderSetting } from "@/lib/pledge-reminders";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { listAccounts } from "@/lib/finance-data";
import { GivingCategoriesManager } from "@/components/settings/giving-categories-manager";
import { GivingReceiptSettings } from "@/components/settings/giving-receipt-settings";
import { PledgeReminderSettings } from "@/components/settings/pledge-reminder-settings";

export const metadata = { title: "Giving · Settings" };

export default async function GivingSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("settings.manage");
  const canManageFinance = await can("finance.manage");

  const [categories, receipt, reminder, accounts, givingTotals] =
    await Promise.all([
      db
        .select({
          id: givingCategory.id,
          name: givingCategory.name,
          description: givingCategory.description,
          isActive: givingCategory.isActive,
          fundAccountId: financeAccount.id,
          fundAccountName: financeAccount.name,
        })
        .from(givingCategory)
        .leftJoin(
          financeAccount,
          eq(financeAccount.givingCategoryId, givingCategory.id),
        )
        .where(eq(givingCategory.churchId, church.id))
        .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name)),
      getGivingReceiptSetting(church.id),
      getPledgeReminderSetting(church.id),
      // Balances come from the same place the Finance pages read them, so the
      // figure shown here can never disagree with the one shown there.
      listAccounts(church.id),
      // What each category would bring in if a fund were created for it now.
      db
        .select({
          categoryId: giving.categoryId,
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        })
        .from(giving)
        .where(eq(giving.churchId, church.id))
        .groupBy(giving.categoryId),
    ]);

  const balanceById = new Map(accounts.map((a) => [a.id, a.balance]));
  const totalsByCategory = new Map(
    givingTotals
      .filter((t) => t.categoryId)
      .map((t) => [
        t.categoryId as string,
        { count: Number(t.count ?? 0), total: Number(t.total ?? 0) },
      ]),
  );

  const rows = categories.map((c) => {
    const totals = totalsByCategory.get(c.id) ?? { count: 0, total: 0 };
    return {
      ...c,
      fundBalance: c.fundAccountId
        ? (balanceById.get(c.fundAccountId) ?? 0)
        : null,
      givingCount: totals.count,
      givingTotal: totals.total,
    };
  });

  const smsReady =
    smsAvailableForCountry(church.country) &&
    church.smsSenderStatus === "approved";

  return (
    <>
      <GivingCategoriesManager
        categories={rows}
        currency={church.currency}
        canManageFinance={canManageFinance}
      />
      <GivingReceiptSettings initial={receipt} smsReady={smsReady} />
      <PledgeReminderSettings initial={reminder} smsReady={smsReady} />
    </>
  );
}
