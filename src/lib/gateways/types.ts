/**
 * What every payment gateway has to be able to do, in our words.
 *
 * Client-safe: this file is types and plain data only, so the settings form
 * can render a provider's fields from the same definition the server validates
 * against. A second copy of "Monnify needs a contract code" is a second copy
 * that goes stale.
 *
 * THREE OPERATIONS, AND NO MORE. Start a payment, verify one, and prove the
 * keys work. Everything else a gateway offers — subscriptions, split payments,
 * payouts, refunds — is deliberately out of scope: the money goes to the
 * church's own account on the church's own terms, and the less of that we
 * reach into, the less of it we can break.
 */

export type ProviderId = "paystack" | "flutterwave" | "monnify" | "link";

/** One credential a provider needs, and how to ask a church for it. */
export type GatewayField = {
  /** Where it is stored: `publicKey`, `secret`, `linkUrl`, or an extras key. */
  key: string;
  label: string;
  /** Said under the field — usually where to find it in the dashboard. */
  hint?: string;
  placeholder?: string;
  /** Sealed before storage and never shown again once saved. */
  secret?: boolean;
  required?: boolean;
};

export type ProviderSpec = {
  id: ProviderId;
  name: string;
  /** One line, for the chooser. */
  blurb: string;
  /** Where the church finds its keys. Shown as a link. */
  dashboardUrl?: string;
  /** The currencies this provider can actually charge. Empty = anything. */
  currencies: string[];
  fields: GatewayField[];
  /** False for "link", which cannot confirm anything and never calls back. */
  canVerify: boolean;
  /**
   * Whether a completed payment reaches us. For "link" it does not — the
   * giver pays on somebody else's page and we are never told, which the UI
   * has to say out loud rather than showing a total that is always zero.
   */
  reportsBack: boolean;
};

/** Everything an adapter needs to talk to one church's account. */
export type GatewayCredentials = {
  publicKey: string | null;
  secret: string | null;
  extra: Record<string, string>;
  linkUrl: string | null;
};

export type StartPaymentInput = {
  reference: string;
  amount: number;
  currency: string;
  email: string;
  name: string | null;
  phone: string | null;
  /** Where the gateway sends the giver back to. Absolute URL. */
  callbackUrl: string;
  /** Shown on the checkout, where the provider supports it. */
  description: string;
  churchName: string;
};

export type StartPaymentResult =
  | { ok: true; checkoutUrl: string; gatewayRef: string | null }
  | { ok: false; error: string };

/**
 * What a verified transaction says. `status` is OUR vocabulary, not the
 * provider's: each one has its own words for the same four outcomes, and
 * translating them once here keeps that mess out of the settle path.
 */
export type VerifyResult =
  | {
      ok: true;
      status: "success" | "failed" | "pending";
      /** What the gateway says was actually paid, in major units. */
      amount: number;
      currency: string;
      gatewayRef: string | null;
      /** The provider's own message, when it refused. */
      message?: string | null;
    }
  | { ok: false; error: string };

export type CheckResult = { ok: true; detail?: string } | { ok: false; error: string };

export type GatewayAdapter = {
  spec: ProviderSpec;
  /** Does this set of credentials actually work? Called before activating. */
  check(creds: GatewayCredentials): Promise<CheckResult>;
  start(
    creds: GatewayCredentials,
    input: StartPaymentInput,
  ): Promise<StartPaymentResult>;
  /** Ask the gateway what really happened. Never trust a redirect's query. */
  verify(creds: GatewayCredentials, reference: string): Promise<VerifyResult>;
  /**
   * Is this webhook genuinely from the provider, for this church?
   *
   * Takes the RAW body, because every one of these signs the exact bytes sent
   * — re-serialising parsed JSON changes them and the signature stops
   * matching, which is a day lost to a mystery.
   */
  verifyWebhook(
    creds: GatewayCredentials,
    raw: string,
    headers: Headers,
  ): { ok: true; reference: string | null } | { ok: false; error: string };
};

/** A gateway's error, in words a church can act on rather than a status code. */
export function gatewayError(provider: ProviderId, detail?: string): string {
  const name =
    provider === "paystack"
      ? "Paystack"
      : provider === "flutterwave"
        ? "Flutterwave"
        : provider === "monnify"
          ? "Monnify"
          : "your payment page";
  return detail
    ? `${name} said: ${detail}`
    : `We couldn't reach ${name}. Try again in a moment.`;
}
