import "server-only";
import { createHmac } from "node:crypto";
import { safeCompare } from "@/lib/secret-box";
import { PROVIDER_SPECS } from "./specs";
import { gatewayError, type GatewayAdapter } from "./types";

/**
 * Monnify.
 *
 * The awkward one, in three ways, all handled here so nothing else has to
 * know:
 *
 *  1. EVERY CALL NEEDS A BEARER TOKEN, obtained by Basic-authing the API key
 *     and secret against /auth/login. It lasts about an hour. We fetch one per
 *     operation rather than caching: a church initialises a handful of
 *     payments an hour, and a cached token shared across churches is a
 *     cross-tenant mistake waiting to happen.
 *  2. A CONTRACT CODE identifies the merchant agreement, and a payment raised
 *     without it is rejected. It is a credential as much as the keys are.
 *  3. THE REFERENCE IS CALLED paymentReference, and the one Monnify generates
 *     (transactionReference) is a different string. Verification uses OURS.
 */
const BASE = "https://api.monnify.com/api";
const TIMEOUT_MS = 20_000;

type MonnifyBody = {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseBody?: Record<string, unknown>;
};

async function login(
  apiKey: string,
  secret: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const basic = Buffer.from(`${apiKey}:${secret}`).toString("base64");
    const res = await fetch(`${BASE}/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as MonnifyBody | null;
    const token = body?.responseBody?.accessToken;
    if (!res.ok || !body?.requestSuccessful || typeof token !== "string") {
      return {
        ok: false,
        error: gatewayError("monnify", body?.responseMessage || `HTTP ${res.status}`),
      };
    }
    return { ok: true, token };
  } catch {
    return { ok: false, error: gatewayError("monnify") };
  }
}

async function call(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as MonnifyBody | null;
    if (!res.ok || !body?.requestSuccessful) {
      return {
        ok: false,
        error: gatewayError("monnify", body?.responseMessage || `HTTP ${res.status}`),
      };
    }
    return { ok: true, data: (body.responseBody ?? {}) as Record<string, unknown> };
  } catch {
    return { ok: false, error: gatewayError("monnify") };
  }
}

export const monnifyAdapter: GatewayAdapter = {
  spec: PROVIDER_SPECS.monnify,

  async check(creds) {
    if (!creds.publicKey || !creds.secret)
      return { ok: false, error: "Add your API key and secret key first." };
    if (!creds.extra.contractCode)
      return { ok: false, error: "Add your contract code — Monnify needs it on every payment." };
    const auth = await login(creds.publicKey, creds.secret);
    if (!auth.ok) return auth;
    const test = /sandbox|_test_/i.test(creds.publicKey);
    return {
      ok: true,
      detail: test
        ? "Connected — but these look like sandbox keys, so no real money will move."
        : "Connected to your Monnify account.",
    };
  },

  async start(creds, input) {
    if (!creds.publicKey || !creds.secret || !creds.extra.contractCode)
      return { ok: false, error: "This church's Monnify details are incomplete." };
    const auth = await login(creds.publicKey, creds.secret);
    if (!auth.ok) return auth;

    const res = await call(auth.token, "/v1/merchant/transactions/init-transaction", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amount,
        customerName: input.name || "Anonymous giver",
        customerEmail: input.email,
        paymentReference: input.reference,
        paymentDescription: input.description.slice(0, 100),
        currencyCode: input.currency,
        contractCode: creds.extra.contractCode,
        redirectUrl: input.callbackUrl,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
      }),
    });
    if (!res.ok) return res;
    const url = res.data.checkoutUrl;
    if (typeof url !== "string")
      return { ok: false, error: gatewayError("monnify", "no checkout link") };
    return {
      ok: true,
      checkoutUrl: url,
      gatewayRef:
        typeof res.data.transactionReference === "string"
          ? res.data.transactionReference
          : null,
    };
  },

  async verify(creds, reference) {
    if (!creds.publicKey || !creds.secret)
      return { ok: false, error: "This church's Monnify details are incomplete." };
    const auth = await login(creds.publicKey, creds.secret);
    if (!auth.ok) return auth;

    const res = await call(
      auth.token,
      `/v2/transactions/${encodeURIComponent(reference)}`,
    );
    if (!res.ok) return res;
    const raw = String(res.data.paymentStatus ?? "").toUpperCase();
    return {
      ok: true,
      /*
       * PARTIALLY_PAID is read as pending, not success.
       *
       * Monnify allows a transfer short of the amount asked for, and treating
       * it as paid would record a gift for more than arrived. It stays pending
       * until the rest lands or the church resolves it by hand.
       */
      status:
        raw === "PAID"
          ? "success"
          : raw === "FAILED" || raw === "CANCELLED" || raw === "EXPIRED"
            ? "failed"
            : "pending",
      amount: Number(res.data.amountPaid ?? res.data.amount ?? 0),
      currency: String(res.data.currencyCode ?? res.data.currency ?? "NGN"),
      gatewayRef:
        typeof res.data.transactionReference === "string"
          ? res.data.transactionReference
          : null,
      message: raw ? `Monnify: ${raw}` : null,
    };
  },

  verifyWebhook(creds, raw, headers) {
    /*
     * monnify-signature is an HMAC-SHA512 of the raw body keyed with the
     * SECRET KEY — so, like Paystack, it is per church and cannot be replayed
     * against another church's endpoint.
     */
    const sig = headers.get("monnify-signature");
    if (!sig) return { ok: false, error: "No signature." };
    if (!creds.secret) return { ok: false, error: "No key to check against." };
    const expected = createHmac("sha512", creds.secret).update(raw).digest("hex");
    if (!safeCompare(sig, expected))
      return { ok: false, error: "Signature did not match." };
    try {
      const body = JSON.parse(raw) as {
        eventData?: { paymentReference?: string };
      };
      return { ok: true, reference: body.eventData?.paymentReference ?? null };
    } catch {
      return { ok: false, error: "Body was not JSON." };
    }
  },
};
