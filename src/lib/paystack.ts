import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerifyAnswer } from "@/lib/paystack-outcome";

const SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE = "https://api.paystack.co";

/**
 * Bounded, so a hanging Paystack cannot hold a callback page (or the webhook
 * Paystack is itself waiting on) open for ever. A timeout is an "unknown"
 * answer, which leaves the payment pending rather than failing it.
 */
const TIMEOUT_MS = 20_000;

export function isPaystackConfigured(): boolean {
  return !!SECRET;
}

export async function paystackInit(opts: {
  email: string;
  amountNaira: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!SECRET) return { ok: false, error: "Payments aren't configured yet." };
  try {
    const res = await fetch(`${BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: opts.email,
        amount: Math.round(opts.amountNaira * 100), // kobo
        reference: opts.reference,
        callback_url: opts.callbackUrl,
        currency: "NGN",
        metadata: opts.metadata,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const data = await res.json().catch((e: unknown) => {
      console.error("[paystack] initialize returned a body that is not JSON", e);
      return null;
    });
    if (!res.ok || !data?.status || !data?.data?.authorization_url) {
      return { ok: false, error: data?.message || "Could not start payment." };
    }
    return { ok: true, url: data.data.authorization_url as string };
  } catch (e) {
    console.error("[paystack] initialize could not reach Paystack", e);
    return { ok: false, error: "Could not reach Paystack." };
  }
}

/**
 * Ask Paystack what happened to a charge.
 *
 * The amount comes back in KOBO, untouched, and the currency with it: whoever
 * decides to honour a payment has to compare both against what was asked for
 * (see classifyCharge), and converting to naira here would round away the one
 * kobo that tells a short payment from a full one.
 */
export async function paystackVerify(reference: string): Promise<
  VerifyAnswer & { metadata?: unknown }
> {
  if (!SECRET) return { ok: false, error: "Payments aren't configured yet." };
  try {
    const res = await fetch(
      `${BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${SECRET}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    const data = await res.json().catch((e: unknown) => {
      console.error(`[paystack] verify ${reference}: body is not JSON`, e);
      return null;
    });
    if (!res.ok || !data?.status || !data?.data) {
      return {
        ok: false,
        error: data?.message || `Could not verify the payment (HTTP ${res.status}).`,
      };
    }
    return {
      ok: true,
      status: String(data.data.status ?? ""),
      amountKobo: Math.round(Number(data.data.amount ?? 0)),
      currency: String(data.data.currency ?? ""),
      metadata: data.data.metadata,
    };
  } catch (e) {
    console.error(`[paystack] verify ${reference}: could not reach Paystack`, e);
    return { ok: false, error: "Could not reach Paystack." };
  }
}

/**
 * Is this webhook body really from Paystack, for OUR account?
 *
 * Paystack signs the raw body as HMAC-SHA512 with the secret key and sends
 * the hex digest in x-paystack-signature. Compared in constant time, on the
 * exact bytes received — a body parsed and re-serialised is a different body.
 */
export function paystackSignatureValid(raw: string, signature: string | null): boolean {
  if (!SECRET || !signature) return false;
  const expected = createHmac("sha512", SECRET).update(raw).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
