import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsWalletTxn } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getSmsPrice } from "@/lib/platform-settings";
import { SmsSettings } from "@/components/settings/sms-settings";

export const metadata = { title: "SMS · Settings" };

export default async function SmsSettingsPage() {
  const { church: c } = await requireChurch();
  await requireCan("settings.manage");

  const [[row], txns, price] = await Promise.all([
    db
      .select({
        senderId: church.smsSenderId,
        status: church.smsSenderStatus,
        note: church.smsSenderNote,
        balance: church.smsBalance,
        currency: church.currency,
      })
      .from(church)
      .where(eq(church.id, c.id))
      .limit(1),
    db
      .select({
        id: smsWalletTxn.id,
        kind: smsWalletTxn.kind,
        amount: smsWalletTxn.amount,
        balanceAfter: smsWalletTxn.balanceAfter,
        reason: smsWalletTxn.reason,
        createdAt: smsWalletTxn.createdAt,
      })
      .from(smsWalletTxn)
      .where(eq(smsWalletTxn.churchId, c.id))
      .orderBy(desc(smsWalletTxn.createdAt))
      .limit(15),
    getSmsPrice(),
  ]);

  return (
    <SmsSettings
      senderId={row.senderId}
      status={row.status}
      note={row.note}
      balance={row.balance}
      currency={row.currency}
      price={price}
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
