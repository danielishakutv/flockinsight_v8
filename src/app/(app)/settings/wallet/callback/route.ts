import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { walletTopup } from "@/db/schema";
import { paystackVerify } from "@/lib/paystack";
import { creditWallet } from "@/lib/wallet";

// Paystack redirects here after a wallet top-up.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref =
    url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/wallet?status=error");

  const [t] = await db
    .select()
    .from(walletTopup)
    .where(eq(walletTopup.reference, ref))
    .limit(1);
  if (!t) redirect("/settings/wallet?status=error");
  if (t.status === "success") redirect("/settings/wallet?status=success");

  const v = await paystackVerify(ref);
  if (v.ok && v.status === "success") {
    await db
      .update(walletTopup)
      .set({ status: "success", paidAt: new Date() })
      .where(eq(walletTopup.id, t.id));
    await creditWallet({
      churchId: t.churchId,
      amount: t.amount,
      category: "topup",
      reason: "Wallet top-up (Paystack)",
      createdBy: t.createdBy,
    });
    redirect("/settings/wallet?status=success");
  }

  await db
    .update(walletTopup)
    .set({ status: "failed" })
    .where(eq(walletTopup.id, t.id));
  redirect("/settings/wallet?status=failed");
}
