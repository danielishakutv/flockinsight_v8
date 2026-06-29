import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { isPaystackConfigured } from "@/lib/paystack";
import { WalletSettings } from "@/components/settings/wallet-settings";

export const metadata = { title: "Wallet · Settings" };

export default async function WalletSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { church: c } = await requireChurch();
  await requireCan("settings.manage");
  const { status } = await searchParams;

  const txns = await db
    .select({
      id: walletTxn.id,
      kind: walletTxn.kind,
      category: walletTxn.category,
      amount: walletTxn.amount,
      balanceAfter: walletTxn.balanceAfter,
      reason: walletTxn.reason,
      createdAt: walletTxn.createdAt,
    })
    .from(walletTxn)
    .where(eq(walletTxn.churchId, c.id))
    .orderBy(desc(walletTxn.createdAt))
    .limit(25);

  // Re-read the live balance (c may be cached from the request).
  const [row] = await db
    .select({ balance: church.walletBalance, currency: church.currency })
    .from(church)
    .where(eq(church.id, c.id))
    .limit(1);

  return (
    <WalletSettings
      balance={Number(row?.balance ?? 0)}
      currency={row?.currency ?? "NGN"}
      paymentsEnabled={isPaystackConfigured()}
      payStatus={status ?? null}
      txns={txns.map((t) => ({
        id: t.id,
        kind: t.kind,
        category: t.category,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        reason: t.reason,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
