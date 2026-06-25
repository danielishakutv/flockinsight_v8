import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { effectivePrice } from "@/lib/billing";
import { PLANS, type PlanId } from "@/lib/plans";
import { PlanBilling } from "@/components/settings/plan-billing";

export const metadata = { title: "Billing · Settings" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { church: c } = await requireChurch();
  await requireCan("settings.manage");
  const { status } = await searchParams;

  const [[row], payments] = await Promise.all([
    db
      .select({
        plan: church.plan,
        renewsAt: church.planRenewsAt,
        discount: church.planDiscountPct,
        currency: church.currency,
      })
      .from(church)
      .where(eq(church.id, c.id))
      .limit(1),
    db
      .select({
        id: payment.id,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        gateway: payment.gateway,
        note: payment.note,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      })
      .from(payment)
      .where(eq(payment.churchId, c.id))
      .orderBy(desc(payment.createdAt))
      .limit(20),
  ]);

  const prices = Object.fromEntries(
    PLANS.map((p) => [p.id, effectivePrice(p.id, row.discount)]),
  ) as Record<PlanId, number | null>;

  return (
    <PlanBilling
      currentPlan={row.plan}
      renewsAt={row.renewsAt ? row.renewsAt.toISOString() : null}
      discount={row.discount}
      prices={prices}
      payments={payments.map((p) => ({
        id: p.id,
        plan: p.plan,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status,
        gateway: p.gateway,
        note: p.note,
        createdAt: (p.paidAt ?? p.createdAt).toISOString(),
      }))}
      status={status ?? null}
    />
  );
}
