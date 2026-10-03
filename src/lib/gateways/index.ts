import "server-only";
import { paystackAdapter } from "./paystack";
import { flutterwaveAdapter } from "./flutterwave";
import { monnifyAdapter } from "./monnify";
import { PROVIDER_SPECS } from "./specs";
import type { GatewayAdapter, ProviderId } from "./types";

/**
 * The "link" provider, which is not a gateway.
 *
 * It exists so the rest of the module has one shape to program against. Every
 * operation refuses, in words: a church on a plain link gets a button and
 * nothing else, and the honest failure of "verify this payment" is "we were
 * never told about it" rather than a crash or a silent success.
 */
const linkAdapter: GatewayAdapter = {
  spec: PROVIDER_SPECS.link,
  async check(creds) {
    const url = (creds.linkUrl || "").trim();
    if (!url) return { ok: false, error: "Paste your payment link first." };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: "That isn't a valid web address." };
    }
    /*
     * https only. This link is printed on a screen in front of a congregation
     * and handed people's card details; an http one would be a plain
     * invitation to have them stolen in transit.
     */
    if (parsed.protocol !== "https:")
      return { ok: false, error: "The link must start with https:// — card details are going through it." };
    return {
      ok: true,
      detail:
        "Saved. Givers will be sent to your own page, so nothing comes back to FlockInsight — record what lands as you do now.",
    };
  },
  async start(creds) {
    const url = (creds.linkUrl || "").trim();
    if (!url) return { ok: false, error: "This church hasn't set a payment link." };
    // Straight there. No reference, because there is nothing to reconcile it
    // against — see the `reportsBack: false` on the spec.
    return { ok: true, checkoutUrl: url, gatewayRef: null };
  },
  async verify() {
    return {
      ok: false,
      error:
        "This church collects through its own payment page, so we're never told what was paid.",
    };
  },
  verifyWebhook() {
    return { ok: false, error: "This provider doesn't send webhooks here." };
  },
};

const ADAPTERS: Record<ProviderId, GatewayAdapter> = {
  paystack: paystackAdapter,
  flutterwave: flutterwaveAdapter,
  monnify: monnifyAdapter,
  link: linkAdapter,
};

/** The adapter for a provider id, or null for something we don't know. */
export function adapterFor(provider: string): GatewayAdapter | null {
  return ADAPTERS[provider as ProviderId] ?? null;
}

export { PROVIDER_SPECS };
export type { GatewayAdapter, ProviderId };
