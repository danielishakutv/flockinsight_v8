import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, payment } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { computeStanding } from "@/lib/trial";
import { offerLabel, priceBook } from "@/lib/plan-offers";
import type { PlanPrice } from "@/lib/plan-price";
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

  /*
   * Every figure on this screen comes from priceBook — the same book the trial
   * gate prints from and the same steps startCheckout bills with (lib/
   * plan-offers.ts). The yearly totals are worked out there, on the server:
   * the toggle on the billing screen chooses between two numbers, it never
   * multiplies a price itself, because a total computed in a client component
   * is a total a browser can edit.
   */
  const book = await priceBook({ country: c.country, planDiscountPct: row.discount });
  const { basePrices, prices, annualPrices, freeMonths } = book;

  const standing = computeStanding(c);

  /*
   * A church outside Nigeria is quoted in its own currency and charged a
   * surcharge covering the international card fee. If the card and the
   * charge ever disagreed, the church would find out on its statement.
   */
  const labels = (set: Record<string, PlanPrice | null>, per: "/mo" | "/yr") =>
    Object.fromEntries(
      Object.entries(set).map(([id, p]) => [id, p && p.baseNgn > 0 ? offerLabel(p, per) : null]),
    );
  const first = book.international;
  const international = first
    ? {
        labels: labels(book.local.monthly, "/mo"),
        /*
         * The yearly figures carry ONE surcharge, not twelve — it is a flat
         * amount per card transaction and a year is one transaction. So these
         * are a separate conversion rather than the monthly label times ten,
         * and paying annually saves a church abroad more than the two months.
         */
        annualLabels: labels(book.local.annual, "/yr"),
        // The struck-through "was" prices, in the same money as the price.
        baseLabels: labels(book.local.baseMonthly, "/mo"),
        annualBaseLabels: labels(book.local.baseAnnual, "/yr"),
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
