import { applyDeliveryReport } from "@/lib/delivery-reports";
import { mapTermiiStatus, termiiReason } from "@/lib/delivery-status";
import { normalizePhone } from "@/lib/sms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/termii — Termii delivery reports (DLR).
 *
 * Configure the URL (including ?key=) at https://termii.com/account/webhook/config
 *
 * Termii documents no request signature, so the shared secret in the query
 * string is the guard — the same convention the cron routes use. A forged
 * report would additionally have to guess a provider-generated message id.
 *
 * Always answers 200 for anything understood or deliberately ignored: a 500
 * makes Termii retry the same report indefinitely.
 */

type TermiiReport = {
  type?: string;
  id?: string;
  message_id?: string;
  receiver?: string;
  sender?: string;
  status?: string;
  channel?: string;
};

const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

export async function POST(request: Request) {
  const secret = process.env.TERMII_WEBHOOK_SECRET;
  const key = new URL(request.url).searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: TermiiReport;
  try {
    payload = (await request.json()) as TermiiReport;
  } catch {
    // Don't log the body — it contains recipients' phone numbers.
    return new Response("Bad request", { status: 400 });
  }

  const state = mapTermiiStatus(payload.status ?? "");
  if (!state) {
    // An unrecognised status is acknowledged, not retried. Logged without the
    // recipient so a new Termii status gets noticed.
    console.warn("[termii] unmapped delivery status:", payload.status);
    return ok({ ok: true, ignored: true });
  }

  const result = await applyDeliveryReport({
    providerMessageId: payload.message_id ?? payload.id ?? null,
    // Termii reports the receiver in international form; ours are stored the
    // same way, but normalise anyway so a "+" or spacing difference matches.
    destination: payload.receiver ? normalizePhone(payload.receiver) : null,
    state,
    reason: termiiReason(payload.status ?? ""),
  });

  // "unmatched" is not an error: the message may have been sent from this
  // Termii account by something other than FlockInsight.
  return ok({ ok: true, result });
}
