"use server";

import { db } from "@/db";
import { walletTopup } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { isPaystackConfigured, paystackInit } from "@/lib/paystack";
import { audit } from "@/lib/audit";

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

  /*
   * Ask Paystack first, and only then write the row.
   *
   * The insert used to come first, so a Paystack that was unreachable left a
   * `pending` top-up behind for money nobody was ever asked for. Nothing is
   * lost or double-charged by that, but `pendingTopups()` shows pending rows to
   * an operator reconciling payments, and a list that fills with top-ups that
   * never existed is a list nobody trusts.
   *
   * The reference is still generated before the call, because it is what ties
   * the two together: Paystack echoes it to the callback, which is what finds
   * this row. Writing the row after means a checkout can only exist with a row
   * to match it, never the other way round.
   */
  const init = await paystackInit({
    email: user.email,
    amountNaira: amount,
    reference,
    callbackUrl: `${BASE_URL}/settings/wallet/callback`,
    metadata: { kind: "wallet_topup", churchId: c.id, amount },
  });
  if (!init.ok) return init;

  /*
   * If this write fails we must NOT hand back the checkout url. Paystack has a
   * transaction open against `reference`, and the callback finds the payment by
   * looking that reference up here — so a checkout with no row would take the
   * money and then fail to credit the wallet. Refusing to return the url keeps
   * the person away from a checkout that could not be honoured.
   */
  try {
    await db
      .insert(walletTopup)
      .values({ churchId: c.id, amount, reference, createdBy: user.id });
  } catch (e) {
    console.error(`wallet topup: could not record ${reference}`, e);
    return {
      ok: false,
      error: "We couldn't start that top-up. Nothing was charged — please try again.",
    };
  }

  await audit({
    churchId: c.id,
    action: "billing.wallet_topup.create",
    summary: `Started a wallet top-up of ₦${amount.toLocaleString()}`,
    targetType: "wallet-topup",
    targetLabel: reference,
    meta: { amount, reference },
    severity: "notice",
  });

  return { ok: true, url: init.url };
}
