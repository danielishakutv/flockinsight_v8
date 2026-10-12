import { redirect } from "next/navigation";
import { settleTopup } from "@/lib/wallet";
import { callbackStatus } from "@/lib/paystack-outcome";

/*
 * Paystack sends the browser here after a wallet top-up.
 *
 * Credits through settleTopup, the same idempotent claim-and-credit the
 * Paystack webhook and the reconcile cron use — so a refresh, a retried
 * redirect or the webhook landing first can never credit one payment twice,
 * and a payer who never comes back is still credited by the webhook.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/wallet?status=error");

  const result = await settleTopup("wallet", ref);
  redirect(`/settings/wallet?status=${callbackStatus(result)}`);
}
