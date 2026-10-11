"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { payment, supportTicket, supportMessage } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { effectivePrice, activatePlan } from "@/lib/billing";
import {
  asCycle,
  cycleMonths,
  cycleTotal,
  type BillingCycle,
} from "@/lib/billing-cycle";
import { getAnnualFreeMonths } from "@/lib/pricing";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { priceForCountry, planAmountLabel } from "@/lib/plan-price";
import { notifySupport } from "@/lib/support";
import { audit } from "@/lib/audit";
import type { PlanId } from "@/lib/plans";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type CheckoutResult =
  | { ok: true; url?: string; activated?: boolean }
  | { ok: false; error: string };

/**
 * Start a payment for one plan, for a month or for a year.
 *
 * The cycle decides two numbers and nothing else: how much is charged, and how
 * many months the plan is then paid up for. Both come from `billing-cycle.ts`,
 * which is the same module the pricing page and the billing screen read — so
 * the figure a church was shown is the figure its card is charged, and the
 * `periodMonths` on the row is what the Partner ledger later prices the
 * commission across.
 *
 * `cycle` is parsed rather than trusted: it arrives from a client component,
 * and `asCycle` means an unexpected value bills a month rather than throwing
 * or, worse, billing a year.
 */
export async function startCheckout(
  plan: PlanId,
  cycleInput: BillingCycle | string = "monthly",
): Promise<CheckoutResult> {
  if (!["starter", "growth", "pro"].includes(plan))
    return { ok: false, error: "Choose a valid plan." };

  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to manage billing." };

  const cycle = asCycle(cycleInput);
  const monthly = await effectivePrice(plan, c.planDiscountPct);
  if (monthly === null)
    return { ok: false, error: "That plan is custom — please contact us." };

  const freeMonths = await getAnnualFreeMonths();
  const months = cycleMonths(cycle);
  /*
   * The whole charge, not the monthly one. A year is ten months of money for
   * twelve months of service, and the multiplication happens HERE rather than
   * on the page: a total computed in a client component is a total a browser
   * can edit.
   */
  const price = cycleTotal(monthly, cycle, freeMonths) ?? 0;

  // Free plan or 100% discount → activate immediately, no payment.
  if (price === 0) {
    await activatePlan(c.id, plan, months);
    await db.insert(payment).values({
      churchId: c.id,
      plan,
      amount: 0,
      currency: c.currency,
      gateway: "manual",
      reference: `FREE-${c.id.slice(0, 8)}-${Date.now()}`,
      status: "success",
      periodMonths: months,
      note: c.planDiscountPct >= 100 ? "100% discount" : "Free plan",
      createdBy: user.id,
      paidAt: new Date(),
    });
    await audit({
      churchId: c.id,
      action: "billing.plan.update",
      summary: `Activated the ${plan} plan at no charge`,
      targetType: "church",
      targetId: c.id,
      targetLabel: plan,
      meta: { plan, price: 0, discountPct: c.planDiscountPct, cycle, months },
      severity: "critical",
    });

    revalidatePath("/settings/billing");
    revalidatePath("/dashboard");
    return { ok: true, activated: true };
  }

  if (!isPaystackConfigured())
    return {
      ok: false,
      error: "Online payment isn't set up yet. Please contact us.",
    };

  /*
   * A church outside Nigeria pays a surcharge covering the international card
   * fee, and is shown the total in its own currency. The CHARGE stays in naira
   * because that is what Paystack settles in and what an international card
   * can already pay — so this is the amount that must reach paystackInit, the
   * payment row, and the audit line. Passing `price` to any of the three would
   * bill the Nigerian figure and eat the fee silently.
   */
  /*
   * Priced ONCE, on the whole charge. Which is also why paying annually is
   * cheaper again for a church abroad: the international card surcharge is a
   * flat amount per transaction, and a year is one transaction rather than
   * twelve.
   */
  const priced = await priceForCountry(price, c.country);

  const annualNote =
    cycle === "annual"
      ? `Annual — ${months} months, ${freeMonths} free (₦${monthly.toLocaleString()}/mo list)`
      : null;

  const reference = `FI-${c.id.slice(0, 8)}-${plan}-${Date.now()}`;
  await db.insert(payment).values({
    churchId: c.id,
    plan,
    amount: priced.chargeNgn,
    currency: "NGN",
    gateway: "paystack",
    reference,
    status: "pending",
    // What the Partner ledger prices its commission across, and what
    // `activatePlan` extends the renewal by once this clears.
    periodMonths: months,
    createdBy: user.id,
    // Recorded on the row so a refund or a query months later can see why the
    // amount is not the list price, without re-running today's exchange rate.
    note:
      [
        annualNote,
        priced.international
          ? `International card fee included (₦${priced.surchargeNgn.toLocaleString()}) — shown to the church as ${planAmountLabel(priced.displayAmount, priced.displayCurrency)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
  });

  const init = await paystackInit({
    email: user.email,
    amountNaira: priced.chargeNgn,
    reference,
    callbackUrl: `${BASE_URL}/settings/billing/callback`,
    metadata: {
      churchId: c.id,
      plan,
      cycle,
      months,
      country: c.country ?? null,
      baseNgn: priced.baseNgn,
      surchargeNgn: priced.surchargeNgn,
      displayAmount: priced.displayAmount,
      displayCurrency: priced.displayCurrency,
    },
  });
  if (!init.ok) return init;

  await audit({
    churchId: c.id,
    action: "billing.checkout.create",
    summary: `Started checkout for the ${plan} plan, ${cycle === "annual" ? `${months} months` : "1 month"} (₦${priced.chargeNgn.toLocaleString()})`,
    targetType: "payment",
    targetLabel: reference,
    meta: {
      plan,
      cycle,
      months,
      price: priced.chargeNgn,
      baseNgn: priced.baseNgn,
      surchargeNgn: priced.surchargeNgn,
      country: c.country ?? null,
      reference,
    },
    severity: "notice",
  });

  return { ok: true, url: init.url };
}

export type ExtendResult = { ok: true } | { ok: false; error: string };

/**
 * Church asks the Head of Missions to extend their free trial. This opens a
 * support ticket ("Extend my trial period") which the team can act on.
 */
export async function requestTrialExtension(): Promise<ExtendResult> {
  const { church: c, user } = await requireChurch();

  const [ticket] = await db
    .insert(supportTicket)
    .values({
      churchId: c.id,
      createdBy: user.id,
      subject: "Extend my trial period",
      category: "billing",
      status: "open",
      contactName: user.name,
      contactEmail: user.email,
    })
    .returning({ id: supportTicket.id });

  const body = `${c.name} is requesting an extension of their free trial (first 7 Sundays). Please review and extend if appropriate.`;
  await db.insert(supportMessage).values({
    ticketId: ticket.id,
    authorType: "church",
    authorUserId: user.id,
    authorName: user.name,
    body,
  });

  await notifySupport({
    kind: "new",
    ticketId: ticket.id,
    churchName: c.name,
    subject: "Extend my trial period",
    category: "billing",
    message: body,
    contactName: user.name,
    contactEmail: user.email,
  }).catch((e: unknown) => {
    // The ticket is already saved; only the staff ping failed. Record it so a
    // request that nobody was told about is traceable rather than invisible.
    console.error("notifySupport failed for trial-extension ticket", e);
  });

  revalidatePath("/help/support");
  return { ok: true };
}
