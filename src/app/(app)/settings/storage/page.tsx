import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getStorageInfo } from "@/lib/storage";
import { getStorageBundles } from "@/lib/pricing";
import { StorageSettings } from "@/components/settings/storage-settings";

export const metadata = { title: "Storage · Settings" };

export default async function StorageSettingsPage() {
  const { church: c } = await requireChurch();
  await requireCan("settings.manage");

  const [storage, bundles, [row]] = await Promise.all([
    getStorageInfo(c.id, c.storageExtraBytes),
    getStorageBundles(),
    db
      .select({
        balance: church.walletBalance,
        currency: church.currency,
        monthlyCost: church.storageMonthlyCost,
        renewsAt: church.storageRenewsAt,
        extraBytes: church.storageExtraBytes,
      })
      .from(church)
      .where(eq(church.id, c.id))
      .limit(1),
  ]);

  return (
    <StorageSettings
      storage={storage}
      bundles={bundles}
      balance={Number(row?.balance ?? 0)}
      currency={row?.currency ?? "NGN"}
      monthlyCost={Number(row?.monthlyCost ?? 0)}
      extraBytes={Number(row?.extraBytes ?? 0)}
      renewsAt={row?.renewsAt ? row.renewsAt.toISOString() : null}
    />
  );
}
