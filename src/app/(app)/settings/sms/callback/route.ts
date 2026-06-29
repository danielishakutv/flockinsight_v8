import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, smsTopup, walletTxn } from "@/db/schema";
import { paystackVerify } from "@/lib/paystack";

// Paystack redirects here after an SMS wallet top-up.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref =
    url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/sms?status=error");

  const [t] = await db
    .select()
    .from(smsTopup)
    .where(eq(smsTopup.reference, ref))
    .limit(1);
  if (!t) redirect("/settings/sms?status=error");
  if (t.status === "success") redirect("/settings/sms?status=success");

  const v = await paystackVerify(ref);
  if (v.ok && v.status === "success") {
    await db.transaction(async (tx) => {
      await tx
        .update(smsTopup)
        .set({ status: "success", paidAt: new Date() })
        .where(eq(smsTopup.id, t.id));

      const [c] = await tx
        .select({ balance: church.walletBalance })
        .from(church)
        .where(eq(church.id, t.churchId))
        .limit(1);
      const newBalance = +((c?.balance ?? 0) + t.amount).toFixed(2);
      await tx
        .update(church)
        .set({ walletBalance: newBalance })
        .where(eq(church.id, t.churchId));
      await tx.insert(walletTxn).values({
        churchId: t.churchId,
        kind: "credit",
        category: "topup",
        amount: t.amount,
        balanceAfter: newBalance,
        reason: "Wallet top-up (Paystack)",
        createdBy: t.createdBy,
      });
    });
    redirect("/settings/sms?status=success");
  }

  await db
    .update(smsTopup)
    .set({ status: "failed" })
    .where(eq(smsTopup.id, t.id));
  redirect("/settings/sms?status=failed");
}
