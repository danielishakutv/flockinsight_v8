import { asc } from "drizzle-orm";
import { db } from "@/db";
import { church, smsSenderSubmission } from "@/db/schema";
import { getSmsPrice } from "@/lib/platform-settings";
import { isSmsConfigured } from "@/lib/sms";
import { normalizeSenderId } from "@/lib/termii-sender";
import { SmsAdmin, type ChurchSms } from "@/components/superadmin/sms-admin";

export const metadata = { title: "SMS · Admin" };

export default async function SuperadminSmsPage() {
  const [price, rows, submissions] = await Promise.all([
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
    db
      .select({
        senderKey: smsSenderSubmission.senderKey,
        state: smsSenderSubmission.state,
        submittedAt: smsSenderSubmission.submittedAt,
        lastStatus: smsSenderSubmission.lastStatus,
      })
      .from(smsSenderSubmission),
  ]);

  // An ID that's already been sent to the network can never be sent again —
  // surface that in the UI so nobody is tempted to try.
  const sent = new Map(submissions.map((s) => [s.senderKey, s]));

  const churches: ChurchSms[] = rows.map((r) => {
    const s = r.senderId ? sent.get(normalizeSenderId(r.senderId)) : undefined;
    return {
      ...r,
      balance: Number(r.balance),
      sentToNetwork: !!s && s.state !== "failed",
      sentAt: s?.submittedAt?.toISOString() ?? null,
      networkStatus: s?.lastStatus ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          SMS
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
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
