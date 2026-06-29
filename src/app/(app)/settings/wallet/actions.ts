"use server";

import { db } from "@/db";
import { walletTopup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";
const MIN_TOPUP = 100;

export type TopupResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Start a Paystack checkout to top up the unified church wallet. */
export async function startWalletTopup(amount: number): Promise<TopupResult> {
  const { church: c, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!Number.isFinite(amount) || amount < MIN_TOPUP)
    return { ok: false, error: `Minimum top-up is ₦${MIN_TOPUP}.` };
  if (amount > 10_000_000)
    return { ok: false, error: "That amount is too large." };
  if (!isPaystackConfigured())
    return { ok: false, error: "Online payment isn't set up yet. Contact us." };

  const reference = `WAL-${c.id.slice(0, 8)}-${Date.now()}`;
  await db
    .insert(walletTopup)
    .values({ churchId: c.id, amount, reference, createdBy: user.id });

  const init = await paystackInit({
    email: user.email,
    amountNaira: amount,
    reference,
    callbackUrl: `${BASE_URL}/settings/wallet/callback`,
    metadata: { kind: "wallet_topup", churchId: c.id, amount },
  });
  if (!init.ok) return init;
  return { ok: true, url: init.url };
}
