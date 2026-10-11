import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { applyDiscount, getAnnualFreeMonths, getPlanPrices } from "@/lib/pricing";
import { annualTotal } from "@/lib/billing-cycle";
import { PLANS, type PlanId } from "@/lib/plans";
import { computeStanding } from "@/lib/trial";
import { pricesForCountry, planPriceLabelFor } from "@/lib/plan-price";
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

  const [basePrices, freeMonths] = await Promise.all([
    getPlanPrices(),
    getAnnualFreeMonths(),
  ]);
  const prices = Object.fromEntries(
    PLANS.map((p) => [p.id, applyDiscount(basePrices[p.id], row.discount)]),
  ) as Record<PlanId, number | null>;

  /*
   * The yearly total for each plan, computed here rather than in the browser.
   *
   * The toggle on the billing screen chooses between two numbers the server
   * worked out; it never multiplies a price itself. A total computed in a
   * client component is a total a browser can edit, and this one is handed
   * straight to a payment.
   */
  const annualPrices = Object.fromEntries(
    PLANS.map((p) => [p.id, annualTotal(prices[p.id], freeMonths)]),
  ) as Record<PlanId, number | null>;

  const standing = computeStanding(c);

  /*
   * A church outside Nigeria is quoted in its own currency and charged a
   * surcharge covering the international card fee. Computed here, on the
   * server, from the SAME helper the checkout action uses — if the card and
   * the charge ever disagreed, the church would find out on its statement.
   */
  const [localised, localisedAnnual] = await Promise.all([
    pricesForCountry(prices, c.country),
    pricesForCountry(annualPrices, c.country),
  ]);
  const first = Object.values(localised).find((p) => p?.international);
  const international = first
    ? {
        labels: Object.fromEntries(
          Object.entries(localised).map(([id, p]) => [
            id,
            p && p.baseNgn > 0 ? planPriceLabelFor(p) : null,
          ]),
        ),
        /*
         * The yearly figures carry ONE surcharge, not twelve — it is a flat
         * amount per card transaction and a year is one transaction. So these
         * are a separate conversion rather than the monthly label times ten,
         * and paying annually saves a church abroad more than the two months.
         */
        annualLabels: Object.fromEntries(
          Object.entries(localisedAnnual).map(([id, p]) => [
            id,
            p && p.baseNgn > 0 ? planPriceLabelFor(p, { perMonth: "/yr" }) : null,
          ]),
        ),
        currency: first.displayCurrency,
        surchargeNgn: first.surchargeNgn,
        live: first.live,
      }
    : null;

  return (
    <PlanBilling
      currentPlan={row.plan}
      renewsAt={row.renewsAt ? row.renewsAt.toISOString() : null}
      discount={row.discount}
      prices={prices}
      annualPrices={annualPrices}
      annualFreeMonths={freeMonths}
      basePrices={basePrices}
      trial={{
        state: standing.state,
        daysLeft: standing.daysLeft,
        waiverEndsAt: standing.waiverEndsAt,
        waiverDaysLeft: standing.waiverDaysLeft,
      }}
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
      international={international}
    />
  );
}
