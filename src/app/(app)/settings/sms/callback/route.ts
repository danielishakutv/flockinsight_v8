import { redirect } from "next/navigation";
import { settleTopup } from "@/lib/wallet";
import { callbackStatus } from "@/lib/paystack-outcome";

/*
 * Paystack sends the browser here after an SMS top-up (the legacy SMS-only
 * checkout; the money lands in the unified wallet).
 *
 * This used to read the balance, add to it in JavaScript and write the
 * absolute figure back — so an SMS batch charged in between was undone, and
 * two hits on this URL credited twice. It now goes through settleTopup, the
 * same atomic, idempotent claim-and-credit as the wallet callback and the
 * Paystack webhook.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/sms?status=error");

  const result = await settleTopup("sms", ref);
  redirect(`/settings/sms?status=${callbackStatus(result)}`);
}
