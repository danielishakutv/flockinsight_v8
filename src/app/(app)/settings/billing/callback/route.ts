import { redirect } from "next/navigation";
import { settleSubscriptionPayment } from "@/lib/billing";
import { callbackStatus } from "@/lib/paystack-outcome";

/*
 * Paystack sends the browser here after checkout.
 *
 * This is ONE of the ways a payment gets honoured, not the way. The browser
 * may never come back (a bank app took over, a phone died, the payer closed
 * the tab), may come back twice, or may come back while a bank transfer is
 * still in flight. So all this does is ask the shared settle function, which
 * the Paystack webhook (api/webhooks/paystack) and the reconcile cron call
 * too, and which is idempotent: however many of them arrive, the plan is
 * extended once.
 *
 * An unanswered verify or a transfer still "ongoing" shows "being confirmed",
 * never "failed" — "failed" for money that then arrived is how a church ends
 * up paying twice.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref) redirect("/settings/billing?status=error");

  const result = await settleSubscriptionPayment(ref);
  redirect(`/settings/billing?status=${callbackStatus(result)}`);
}
