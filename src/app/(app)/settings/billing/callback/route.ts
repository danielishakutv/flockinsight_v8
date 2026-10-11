import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { paystackVerify } from "@/lib/paystack";
import { activatePlan } from "@/lib/billing";
import { awardReferralIfDue } from "@/lib/referrals";
import { awardPartnerCommission } from "@/lib/partners";
import type { PlanId } from "@/lib/plans";

// Paystack redirects the browser here after checkout.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/billing?status=error");

  const [p] = await db
    .select()
    .from(payment)
    .where(eq(payment.reference, ref))
    .limit(1);
  if (!p) redirect("/settings/billing?status=error");
  if (p.status === "success") redirect("/settings/billing?status=success");

  const v = await paystackVerify(ref);
  if (v.ok && v.status === "success") {
    await db
      .update(payment)
      .set({ status: "success", paidAt: new Date() })
      .where(eq(payment.id, p.id));
    await activatePlan(p.churchId, p.plan as PlanId, p.periodMonths);
    // The referral bonus is paid here rather than at signup: we only give
    // money away once a referred church has actually paid us. Idempotent, so
    // a replayed callback — which Paystack does send — cannot pay twice, and
    // it never throws, so a bonus failure can't fail a successful payment.
    await awardReferralIfDue(p.churchId);
    /*
     * And the Partner's commission, for the same reason and with the same two
     * properties: idempotent, because Paystack replays this callback, and it
     * never throws, because a commission that failed to record must not turn
     * a payment the church has already made into a failed one. Which payment
     * of theirs this is decides whether it earns the first commission, the
     * second, or the trail.
     */
    await awardPartnerCommission(p.id);
    redirect("/settings/billing?status=success");
  }

  await db
    .update(payment)
    .set({ status: "failed" })
    .where(eq(payment.id, p.id));
  redirect("/settings/billing?status=failed");
}
