"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { payment, supportTicket, supportMessage } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { activatePlan } from "@/lib/billing";
import { asCycle, type BillingCycle } from "@/lib/billing-cycle";
import { chargeFor } from "@/lib/plan-offers";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { planAmountLabel } from "@/lib/plan-price";
import { notifySupport } from "@/lib/support";
import { audit } from "@/lib/audit";
import { parsePlanKey, type PlanId } from "@/lib/plans";
import { resolvePlanKey } from "@/lib/plan-catalog";

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
  /** A plan key: "growth", or "custom:<id>" for a plan made at /superadmin/plans. */
  planKey: string,
  cycleInput: BillingCycle | string = "monthly",
): Promise<CheckoutResult> {
  const parsedKey = parsePlanKey(planKey);
  if (!parsedKey || ("tier" in parsedKey && !["starter", "growth", "pro"].includes(parsedKey.tier)))
    return { ok: false, error: "Choose a valid plan." };

  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to manage billing." };

  const target = await resolvePlanKey(planKey);
  if (!target) return { ok: false, error: "Choose a valid plan." };
  /*
   * A custom plan is bought only when it is on offer — on the website and not
   * archived — or when it is the church's own plan, which it may always
   * renew. The key comes from a browser; a hidden plan's id in a hand-made
   * request must not buy a price agreed with somebody else.
   */
  if (target.customPlanId) {
    const own = c.customPlanId === target.customPlanId;
    if (!own && (target.archived || !target.showOnWebsite))
      return { ok: false, error: "That plan isn't available. Please choose another." };
  }
  const plan: PlanId = target.plan;
  const choice = { plan, customPlanId: target.customPlanId };

  const cycle = asCycle(cycleInput);
  /*
   * The whole charge, not the monthly one. A year is ten months of money for
   * twelve months of service, and the multiplication happens HERE rather than
   * on the page: a total computed in a client component is a total a browser
   * can edit. `chargeFor` is the same book the billing page and the trial
   * gate print from, so the figure a church was shown is the one billed.
   */
  const charge = await chargeFor(planKey, cycle, c);
  if (!charge)
    return { ok: false, error: "That plan is custom — please contact us." };
  const { monthly, months, freeMonths, priced } = charge;
  const price = charge.total;

  /*
   * A ₦0 charge for a paid tier, without a 100% discount, is a misconfigured
   * price (a superadmin cleared the field and it saved as 0), not a free plan.
   * Activating on it would hand out Growth or Pro — and a year of it — for
   * nothing. Refuse, loudly, rather than give the product away.
   */
  // A custom plan priced at 0 was made free on purpose; only a tier can be misconfigured this way.
  if (price === 0 && !target.customPlanId && plan !== "starter" && c.planDiscountPct < 100) {
    console.error(
      `[billing] ${plan} resolves to ₦0 without a 100% discount — refusing to activate it free`,
    );
    return {
      ok: false,
      error: "This plan's price is being updated — please try again shortly or contact us.",
    };
  }

  // Free plan or 100% discount → activate immediately, no payment.
  if (price === 0) {
    /*
     * The activation and its ₦0 row in one transaction: a row without the
     * plan, or the plan without its row, is a ledger that cannot explain
     * itself. Remaining paid time on another tier is revalued (it is free
     * time now, so moving it onto a paid tier is worth nothing; see
     * lib/plan-period.ts) and an unexpired trial is kept.
     */
    try {
      await db.transaction(async (tx) => {
        await activatePlan(c.id, choice, months, { tx, convertRemaining: true });
        await tx.insert(payment).values({
          churchId: c.id,
          plan,
          customPlanId: target.customPlanId,
          amount: 0,
          // Every payment row is in naira, whatever the church's own money.
          currency: "NGN",
          gateway: "manual",
          reference: `FREE-${c.id.slice(0, 8)}-${Date.now()}`,
          status: "success",
          periodMonths: months,
          note: c.planDiscountPct >= 100 ? "100% discount" : "Free plan",
          createdBy: user.id,
          paidAt: new Date(),
        });
      });
    } catch (e) {
      // A result, not a rejection: the button on the page re-enables and says so.
      console.error(`[billing] could not activate ${plan} at no charge for ${c.id}`, e);
      return {
        ok: false,
        error: "We couldn't activate that plan. Nothing changed — please try again.",
      };
    }
    await audit({
      churchId: c.id,
      action: "billing.plan.update",
      summary: `Activated the ${target.name} plan at no charge`,
      targetType: "church",
      targetId: c.id,
      targetLabel: target.name,
      meta: { plan: planKey, price: 0, discountPct: c.planDiscountPct, cycle, months },
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
   * twelve. (`priced`, from chargeFor above.)
   */

  const annualNote =
    cycle === "annual"
      ? `Annual — ${months} months, ${freeMonths} free (₦${monthly.toLocaleString()}/mo list)`
      : null;

  const reference = `FI-${c.id.slice(0, 8)}-${plan}-${Date.now()}`;
  /*
   * If this write fails, do not open a checkout: the callback, the webhook and
   * the reconcile cron all find the payment by this reference, so a checkout
   * with no row would take the money and honour nothing.
   */
  try {
    await db.insert(payment).values({
      churchId: c.id,
      plan,
      customPlanId: target.customPlanId,
      amount: priced.chargeNgn,
      currency: "NGN",
      gateway: "paystack",
      reference,
      status: "pending",
      // What the Partner ledger prices its commission across, and what
      // `activatePlan` extends the renewal by once this clears.
      periodMonths: months,
      /*
       * The part of the charge that is not the plan: the international card
       * surcharge and the rounding to a whole ₦100 (both are `chargeNgn -
       * baseNgn`). It passes through to the card network, so it is not
       * revenue a Partner earns commission on.
       */
      surchargeAmount: Math.max(0, priced.chargeNgn - priced.baseNgn),
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
  } catch (e) {
    console.error(`[billing] could not record checkout ${reference}`, e);
    return {
      ok: false,
      error: "We couldn't start that payment. Nothing was charged — please try again.",
    };
  }

  const init = await paystackInit({
    email: user.email,
    amountNaira: priced.chargeNgn,
    reference,
    callbackUrl: `${BASE_URL}/settings/billing/callback`,
    metadata: {
      churchId: c.id,
      plan,
      customPlanId: target.customPlanId,
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
    summary: `Started checkout for the ${target.name} plan, ${cycle === "annual" ? `${months} months` : "1 month"} (₦${priced.chargeNgn.toLocaleString()})`,
    targetType: "payment",
    targetLabel: reference,
    meta: {
      plan,
      customPlanId: target.customPlanId,
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
