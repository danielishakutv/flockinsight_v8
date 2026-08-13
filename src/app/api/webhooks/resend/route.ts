import crypto from "node:crypto";
import { applyDeliveryReport } from "@/lib/delivery-reports";
import { mapResendEvent, resendReason } from "@/lib/delivery-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/resend — Resend email delivery events.
 *
 * Configure in the Resend dashboard and put the signing secret in
 * RESEND_WEBHOOK_SECRET.
 *
 * Resend signs with Svix. The signature is verified here with node:crypto
 * rather than pulling in the svix package — it is a short, well-specified
 * HMAC and avoids another dependency.
 */

type ResendEvent = {
  type?: string;
  data?: { email_id?: string; to?: string | string[] };
};

/**
 * Svix scheme: HMAC-SHA256 over "<id>.<timestamp>.<body>", keyed by the secret
 * (base64, after the "whsec_" prefix). The header may carry several
 * space-separated versioned signatures during key rotation.
 */
function verifySignature(
  secret: string,
  headers: Headers,
  body: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;

  // Reject anything older than five minutes so a captured request can't be
  // replayed indefinitely.
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000) {
    return false;
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  for (const part of signatures.split(" ")) {
    const [, sig] = part.split(",");
    if (!sig) continue;
    const given = Buffer.from(sig);
    if (
      given.length === expectedBuf.length &&
      crypto.timingSafeEqual(given, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 401 });

  // The raw body is what was signed, so read it as text before parsing.
  const raw = await request.text();
  if (!verifySignature(secret, request.headers, raw)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: ResendEvent;
  try {
    payload = JSON.parse(raw) as ResendEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const state = mapResendEvent(payload.type ?? "");
  // Opens, clicks and complaints are accepted and ignored by decision —
  // delivery reporting only.
  if (!state) return ok({ ok: true, ignored: true });

  const to = payload.data?.to;
  const destination = Array.isArray(to) ? to[0] : to;

  const result = await applyDeliveryReport({
    providerMessageId: payload.data?.email_id ?? null,
    destination: destination ? destination.toLowerCase() : null,
    state,
    reason: resendReason(payload.type ?? ""),
  });

  return ok({ ok: true, result });
}
