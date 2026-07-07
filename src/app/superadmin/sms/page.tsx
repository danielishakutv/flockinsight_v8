import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getSmsPrice } from "@/lib/platform-settings";
import { isSmsConfigured } from "@/lib/sms";
import { SmsAdmin, type ChurchSms } from "@/components/superadmin/sms-admin";

export const metadata = { title: "SMS · Admin" };

export default async function SuperadminSmsPage() {
  const [price, rows] = await Promise.all([
    getSmsPrice(),
    db
      .select({
        id: church.id,
        name: church.name,
        currency: church.currency,
        senderId: church.smsSenderId,
        status: church.smsSenderStatus,
        stage: church.smsSenderStage,
        note: church.smsSenderNote,
        balance: church.walletBalance,
      })
      .from(church)
      .orderBy(asc(church.name)),
  ]);

  const churches: ChurchSms[] = rows.map((r) => ({ ...r, balance: Number(r.balance) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          SMS
        </h1>
        <p className="text-muted-foreground mt-1">
          Set the SMS price, approve sender IDs and manage church wallets.
        </p>
      </div>
      <SmsAdmin
        price={price}
        churches={churches}
        gatewayReady={isSmsConfigured()}
      />
    </div>
  );
}
