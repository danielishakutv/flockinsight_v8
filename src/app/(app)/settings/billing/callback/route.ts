import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { paystackVerify } from "@/lib/paystack";
import { activatePlan } from "@/lib/billing";
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
    redirect("/settings/billing?status=success");
  }

  await db
    .update(payment)
    .set({ status: "failed" })
    .where(eq(payment.id, p.id));
  redirect("/settings/billing?status=failed");
}
