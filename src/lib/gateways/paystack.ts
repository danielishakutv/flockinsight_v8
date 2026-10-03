import "server-only";
import { createHmac } from "node:crypto";
import { safeCompare } from "@/lib/secret-box";
import { PROVIDER_SPECS } from "./specs";
import { gatewayError, type GatewayAdapter } from "./types";

/**
 * Paystack, with the CHURCH's keys.
 *
 * Not to be confused with lib/paystack.ts, which uses the PLATFORM's key to
 * charge churches for their own subscription. Same provider, opposite
 * direction, and keeping them in separate files is what stops a church's gift
 * ever being initialised with our key or settled into our account.
 *
 * Amounts are in kobo/pesewas — the subunit. Every integration bug with this
 * provider is ultimately this line, so the conversion happens once, here, and
 * the rest of the module speaks in whole naira.
 */
const BASE = "https://api.paystack.co";

/** Bounded so a hanging gateway cannot hold a public page open for ever. */
const TIMEOUT_MS = 20_000;

function toSubunit(amount: number): number {
  return Math.round(amount * 100);
}

function fromSubunit(amount: number): number {
  return Math.round(amount) / 100;
}

async function call(
  secret: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: Record<string, unknown> }
      | null;
    if (!res.ok || !body?.status) {
      return {
        ok: false,
        error: gatewayError("paystack", body?.message || `HTTP ${res.status}`),
      };
    }
    return { ok: true, data: (body.data ?? {}) as Record<string, unknown> };
  } catch {
    return { ok: false, error: gatewayError("paystack") };
  }
}

export const paystackAdapter: GatewayAdapter = {
  spec: PROVIDER_SPECS.paystack,

  async check(creds) {
    if (!creds.secret) return { ok: false, error: "Add your secret key first." };
    /*
     * Listing the merchant's own banks proves three things at once: the key is
     * real, it is live (not revoked), and it belongs to an account that can
     * take payments. A cheap read-only call — nothing is created to test it.
     */
    const res = await call(creds.secret, "/transaction/totals");
    if (!res.ok) return res;
    if (creds.publicKey && !/^pk_(test|live)_/.test(creds.publicKey)) {
      return {
        ok: false,
        error:
          "That doesn't look like a Paystack public key — it should start with pk_live_ or pk_test_.",
      };
    }
    // Said out loud, because a church testing with test keys and wondering why
    // no money arrives is a support conversation nobody needs.
    const live = creds.secret.startsWith("sk_live_");
    return {
      ok: true,
      detail: live
        ? "Connected to your live Paystack account."
        : "Connected — but these are TEST keys, so no real money will move.",
    };
  },

  async start(creds, input) {
    if (!creds.secret)
      return { ok: false, error: "This church's Paystack keys are missing." };
    const res = await call(creds.secret, "/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: toSubunit(input.amount),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: {
          // Shown on the church's own Paystack dashboard, so a gift there can
          // be recognised without opening FlockInsight.
          church: input.churchName,
          purpose: input.description,
          custom_fields: [
            {
              display_name: "Giver",
              variable_name: "giver",
              value: input.name ?? "Anonymous",
            },
          ],
        },
      }),
    });
    if (!res.ok) return res;
    const url = res.data.authorization_url;
    if (typeof url !== "string")
      return { ok: false, error: gatewayError("paystack", "no checkout link") };
    return {
      ok: true,
      checkoutUrl: url,
      gatewayRef: typeof res.data.reference === "string" ? res.data.reference : null,
    };
  },

  async verify(creds, reference) {
    if (!creds.secret)
      return { ok: false, error: "This church's Paystack keys are missing." };
    const res = await call(
      creds.secret,
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    if (!res.ok) return res;
    const raw = String(res.data.status ?? "");
    return {
      ok: true,
      // Paystack's vocabulary: success | failed | abandoned | ongoing |
      // pending | reversed. Anything that is not plainly done or plainly dead
      // is treated as pending, so a gift is never written off while it is
      // still being processed.
      status:
        raw === "success"
          ? "success"
          : raw === "failed" || raw === "reversed" || raw === "abandoned"
            ? "failed"
            : "pending",
      amount: fromSubunit(Number(res.data.amount ?? 0)),
      currency: String(res.data.currency ?? ""),
      gatewayRef:
        typeof res.data.id === "number" || typeof res.data.id === "string"
          ? String(res.data.id)
          : null,
      message: typeof res.data.gateway_response === "string"
        ? res.data.gateway_response
        : null,
    };
  },

  verifyWebhook(creds, raw, headers) {
    /*
     * Paystack signs the raw body with the SECRET KEY, as HMAC-SHA512, in
     * x-paystack-signature. So the signature is per church: a webhook signed
     * for one church cannot validate against another's key, which is exactly
     * the property needed when one URL serves every church.
     */
    const sig = headers.get("x-paystack-signature");
    if (!sig) return { ok: false, error: "No signature." };
    if (!creds.secret) return { ok: false, error: "No key to check against." };
    const expected = createHmac("sha512", creds.secret).update(raw).digest("hex");
    if (!safeCompare(sig, expected))
      return { ok: false, error: "Signature did not match." };
    try {
      const body = JSON.parse(raw) as { data?: { reference?: string } };
      return { ok: true, reference: body.data?.reference ?? null };
    } catch {
      return { ok: false, error: "Body was not JSON." };
    }
  },
};
