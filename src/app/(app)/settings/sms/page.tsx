import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, walletTxn } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getSmsPrice } from "@/lib/platform-settings";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { WALLET_CURRENCY } from "@/lib/wallet-currency";
import { SmsSettings } from "@/components/settings/sms-settings";

export const metadata = { title: "SMS · Settings" };

export default async function SmsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { church: c } = await requireChurch();
  await requireCan("settings.manage");
  const { status } = await searchParams;

  const [[row], txns, price] = await Promise.all([
    db
      .select({
        senderId: church.smsSenderId,
        status: church.smsSenderStatus,
        stage: church.smsSenderStage,
        note: church.smsSenderNote,
        balance: church.walletBalance,
      })
      .from(church)
      .where(eq(church.id, c.id))
      .limit(1),
    db
      .select({
        id: walletTxn.id,
        kind: walletTxn.kind,
        amount: walletTxn.amount,
        balanceAfter: walletTxn.balanceAfter,
        reason: walletTxn.reason,
        createdAt: walletTxn.createdAt,
      })
      .from(walletTxn)
      .where(eq(walletTxn.churchId, c.id))
      .orderBy(desc(walletTxn.createdAt))
      .limit(15),
    getSmsPrice(),
  ]);

  return (
    <SmsSettings
      senderId={row.senderId}
      status={row.status}
      stage={row.stage}
      smsAvailable={smsAvailableForCountry(c.country)}
      country={c.country}
      note={row.note}
      balance={row.balance}
      // SMS credit is the naira wallet, for every church (lib/wallet-currency).
      currency={WALLET_CURRENCY}
      price={price}
      payStatus={status ?? null}
      txns={txns.map((t) => ({
        id: t.id,
        kind: t.kind,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        reason: t.reason,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
