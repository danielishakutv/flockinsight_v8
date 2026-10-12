import { paystackSignatureValid } from "@/lib/paystack";
import { settlePaystackReference } from "@/lib/billing";
import { referenceKind } from "@/lib/paystack-outcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/paystack — the PLATFORM's Paystack account telling us a
 * charge completed: subscriptions (FI-), wallet top-ups (WAL-) and legacy SMS
 * top-ups (SMS-).
 *
 * Not to be confused with /api/pay/paystack, which is the per-church ONLINE
 * GIVING webhook, signed with each church's own key. Different account,
 * different secret, different URL — a gift can never land here and a
 * subscription can never land there. Register this one in the platform
 * Paystack dashboard (Settings → API Keys & Webhooks).
 *
 * Why it exists: crediting used to happen only when the payer's browser came
 * back to the callback. A bank transfer finished in another app, a phone that
 * died on the 3-D Secure page, a WhatsApp in-app browser with no session —
 * Paystack had the church's money and the church stayed behind the paywall
 * until a human noticed.
 *
 * Nothing in the payload is trusted beyond "look at this reference": the
 * signature proves Paystack sent it, and the settle function then asks
 * Paystack's verify endpoint itself and checks the amount and currency against
 * what we asked for. The settle is idempotent, so Paystack's retries, the
 * browser callback and the reconcile cron can all arrive in any order.
 *
 * 200 for everything we have read, including events we do not act on —
 * retrying is not what fixes them. 401 for a bad signature. 500 only when
 * settling itself threw (the database was unreachable), because THAT is worth
 * Paystack trying again.
 */
export async function POST(request: Request) {
  // The RAW body: the signature is over these exact bytes.
  const raw = await request.text();
  if (!paystackSignatureValid(raw, request.headers.get("x-paystack-signature"))) {
    console.warn("[webhooks/paystack] signature did not verify");
    return Response.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: unknown } };
  try {
    event = JSON.parse(raw);
  } catch (e) {
    console.error("[webhooks/paystack] signed body is not JSON", e);
    return Response.json({ ok: true, ignored: "not json" });
  }

  const reference =
    typeof event.data?.reference === "string" ? event.data.reference : null;
  if (event.event !== "charge.success" || !reference) {
    return Response.json({ ok: true, ignored: event.event ?? "no event" });
  }
  if (!referenceKind(reference)) {
    // Our account, but not a checkout this code issued (a payment link made
    // in the dashboard, say). Logged so it can be looked at, not retried.
    console.warn(`[webhooks/paystack] reference ${reference} is not one of ours`);
    return Response.json({ ok: true, ignored: "unknown reference" });
  }

  try {
    const result = await settlePaystackReference(reference, "Paystack webhook");
    if (result === "mismatch" || result === "not-found")
      console.error(`[webhooks/paystack] ${reference}: ${result}`);
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error(`[webhooks/paystack] settling ${reference} threw`, e);
    return Response.json({ ok: false, error: "Could not settle." }, { status: 500 });
  }
}
