import "server-only";
import { safeCompare } from "@/lib/secret-box";
import { PROVIDER_SPECS } from "./specs";
import { gatewayError, type GatewayAdapter } from "./types";

/**
 * Flutterwave (v3 standard checkout).
 *
 * Two things about this provider shape the code.
 *
 * AMOUNTS ARE IN MAJOR UNITS — naira, not kobo, the opposite of Paystack. The
 * two adapters sit next to each other precisely so that difference is visible
 * rather than remembered.
 *
 * VERIFY BY OUR OWN REFERENCE, not by their transaction id. The redirect hands
 * back `transaction_id`, but a webhook may arrive first and the id is not
 * something we chose — `/transactions/verify_by_reference` lets one settle
 * path answer "did reference X complete?" whichever way the news arrived.
 */
const BASE = "https://api.flutterwave.com/v3";
const TIMEOUT_MS = 20_000;

type FlwBody = {
  status?: string;
  message?: string;
  data?: Record<string, unknown>;
};

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
    const body = (await res.json().catch(() => null)) as FlwBody | null;
    if (!res.ok || body?.status !== "success") {
      return {
        ok: false,
        error: gatewayError("flutterwave", body?.message || `HTTP ${res.status}`),
      };
    }
    return { ok: true, data: (body.data ?? {}) as Record<string, unknown> };
  } catch {
    return { ok: false, error: gatewayError("flutterwave") };
  }
}

export const flutterwaveAdapter: GatewayAdapter = {
  spec: PROVIDER_SPECS.flutterwave,

  async check(creds) {
    if (!creds.secret) return { ok: false, error: "Add your secret key first." };
    if (creds.publicKey && !/^FLWPUBK/i.test(creds.publicKey)) {
      return {
        ok: false,
        error:
          "That doesn't look like a Flutterwave public key — it should start with FLWPUBK.",
      };
    }
    // A read-only listing: proves the key is live without creating anything.
    const res = await call(creds.secret, "/subaccounts?page=1");
    if (!res.ok) return res;
    const test = /test/i.test(creds.secret);
    const hash = creds.extra.secretHash;
    const notes = [
      test ? "these are TEST keys, so no real money will move" : null,
      hash
        ? null
        : "no webhook secret hash yet, so gifts are recorded when the giver returns to the page rather than the moment Flutterwave confirms them",
    ].filter(Boolean);
    return {
      ok: true,
      detail: notes.length
        ? `Connected — but ${notes.join("; and ")}.`
        : "Connected to your live Flutterwave account.",
    };
  },

  async start(creds, input) {
    if (!creds.secret)
      return { ok: false, error: "This church's Flutterwave keys are missing." };
    const res = await call(creds.secret, "/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.callbackUrl,
        customer: {
          email: input.email,
          name: input.name ?? undefined,
          phonenumber: input.phone ?? undefined,
        },
        customizations: {
          title: input.churchName.slice(0, 40),
          description: input.description.slice(0, 100),
        },
        /*
         * Card and transfer only, deliberately.
         *
         * Leaving this unset offers every method enabled on the account,
         * including ones that complete hours later by their nature. A giving
         * page that says "thank you" and then has to un-say it is worse than
         * a shorter list of ways to pay.
         */
        payment_options: "card,banktransfer,ussd",
      }),
    });
    if (!res.ok) return res;
    const url = res.data.link;
    if (typeof url !== "string")
      return { ok: false, error: gatewayError("flutterwave", "no checkout link") };
    return { ok: true, checkoutUrl: url, gatewayRef: null };
  },

  async verify(creds, reference) {
    if (!creds.secret)
      return { ok: false, error: "This church's Flutterwave keys are missing." };
    const res = await call(
      creds.secret,
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    if (!res.ok) return res;
    const raw = String(res.data.status ?? "").toLowerCase();
    return {
      ok: true,
      status:
        raw === "successful"
          ? "success"
          : raw === "failed" || raw === "cancelled"
            ? "failed"
            : "pending",
      // `charged_amount` includes the fee when the giver pays it; `amount` is
      // what the church asked for, which is what a receipt should say.
      amount: Number(res.data.amount ?? 0),
      currency: String(res.data.currency ?? ""),
      gatewayRef: res.data.id != null ? String(res.data.id) : null,
      message:
        typeof res.data.processor_response === "string"
          ? res.data.processor_response
          : null,
    };
  },

  verifyWebhook(creds, raw, headers) {
    /*
     * Flutterwave sends `verif-hash`, which is whatever the merchant typed
     * into their dashboard — not a signature over the body. So it proves the
     * sender knows the shared secret and nothing about the payload.
     *
     * With no hash configured there is nothing to check, and an unverified
     * webhook is refused rather than trusted: the giver's own redirect still
     * settles the gift, a few seconds later, against a verify call we make
     * ourselves.
     */
    const sent = headers.get("verif-hash");
    const expected = creds.extra.secretHash;
    if (!expected)
      return {
        ok: false,
        error:
          "No webhook secret hash is set for this church, so this cannot be verified.",
      };
    if (!sent) return { ok: false, error: "No verif-hash header." };
    if (!safeCompare(sent, expected))
      return { ok: false, error: "Hash did not match." };
    try {
      const body = JSON.parse(raw) as {
        data?: { tx_ref?: string };
        txRef?: string;
      };
      return { ok: true, reference: body.data?.tx_ref ?? body.txRef ?? null };
    } catch {
      return { ok: false, error: "Body was not JSON." };
    }
  },
};
