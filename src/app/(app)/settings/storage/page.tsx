import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getStorageInfo } from "@/lib/storage";
import { getStorageBundles } from "@/lib/pricing";
import { storageSwitchQuote } from "@/lib/storage-switch";
import { GB } from "@/lib/storage-bytes";
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
        monthlyCost: church.storageMonthlyCost,
        renewsAt: church.storageRenewsAt,
        extraBytes: church.storageExtraBytes,
      })
      .from(church)
      .where(eq(church.id, c.id))
      .limit(1),
  ]);

  /*
   * What each bundle would cost RIGHT NOW, from the same rule the action
   * charges by — so the button can say "₦1,240 now" and mean it.
   */
  const state = {
    currentGb: Math.round(Number(row?.extraBytes ?? 0) / GB),
    currentMonthlyCost: Number(row?.monthlyCost ?? 0),
    renewsAt: row?.renewsAt ?? null,
  };
  const quotes = Object.fromEntries(
    bundles.map((b) => {
      const q = storageSwitchQuote(state, b);
      return [
        b.gb,
        q.kind === "same"
          ? null
          : q.kind === "downgrade"
            ? { charge: 0, refund: q.refund }
            : { charge: q.charge, refund: 0 },
      ];
    }),
  );

  return (
    <StorageSettings
      storage={storage}
      bundles={bundles}
      quotes={quotes}
      balance={Number(row?.balance ?? 0)}
      monthlyCost={Number(row?.monthlyCost ?? 0)}
      extraBytes={Number(row?.extraBytes ?? 0)}
      renewsAt={row?.renewsAt ? row.renewsAt.toISOString() : null}
    />
  );
}
