import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { givingCategory } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getGivingReceiptSetting } from "@/lib/giving-receipts";
import { getPledgeReminderSetting } from "@/lib/pledge-reminders";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { GivingCategoriesManager } from "@/components/settings/giving-categories-manager";
import { GivingReceiptSettings } from "@/components/settings/giving-receipt-settings";
import { PledgeReminderSettings } from "@/components/settings/pledge-reminder-settings";

export const metadata = { title: "Giving · Settings" };

export default async function GivingSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("settings.manage");
  const [categories, receipt, reminder] = await Promise.all([
    db
      .select({
        id: givingCategory.id,
        name: givingCategory.name,
        description: givingCategory.description,
        isActive: givingCategory.isActive,
      })
      .from(givingCategory)
      .where(eq(givingCategory.churchId, church.id))
      .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name)),
    getGivingReceiptSetting(church.id),
    getPledgeReminderSetting(church.id),
  ]);

  const smsReady =
    smsAvailableForCountry(church.country) &&
    church.smsSenderStatus === "approved";

  return (
    <>
      <GivingCategoriesManager categories={categories} />
      <GivingReceiptSettings initial={receipt} smsReady={smsReady} />
      <PledgeReminderSettings initial={reminder} smsReady={smsReady} />
    </>
  );
}
