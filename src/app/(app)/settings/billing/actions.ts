"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { effectivePrice, activatePlan } from "@/lib/billing";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import type { PlanId } from "@/lib/plans";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type CheckoutResult =
  | { ok: true; url?: string; activated?: boolean }
  | { ok: false; error: string };

export async function startCheckout(plan: PlanId): Promise<CheckoutResult> {
  if (!["starter", "growth", "pro"].includes(plan))
    return { ok: false, error: "Choose a valid plan." };

  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to manage billing." };

  const price = await effectivePrice(plan, c.planDiscountPct);
  if (price === null)
    return { ok: false, error: "That plan is custom — please contact us." };

  // Free plan or 100% discount → activate immediately, no payment.
  if (price === 0) {
    await activatePlan(c.id, plan, 1);
    await db.insert(payment).values({
      churchId: c.id,
      plan,
      amount: 0,
      currency: c.currency,
      gateway: "manual",
      reference: `FREE-${c.id.slice(0, 8)}-${Date.now()}`,
      status: "success",
      periodMonths: 1,
      note: c.planDiscountPct >= 100 ? "100% discount" : "Free plan",
      createdBy: user.id,
      paidAt: new Date(),
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

  const reference = `FI-${c.id.slice(0, 8)}-${plan}-${Date.now()}`;
  await db.insert(payment).values({
    churchId: c.id,
    plan,
    amount: price,
    currency: "NGN",
    gateway: "paystack",
    reference,
    status: "pending",
    periodMonths: 1,
    createdBy: user.id,
  });

  const init = await paystackInit({
    email: user.email,
    amountNaira: price,
    reference,
    callbackUrl: `${BASE_URL}/settings/billing/callback`,
    metadata: { churchId: c.id, plan },
  });
  if (!init.ok) return init;
  return { ok: true, url: init.url };
}
