import type { ProviderId, ProviderSpec } from "./types";

/**
 * The four ways a church can collect, as plain data.
 *
 * Client-safe on purpose: the settings form renders a provider's fields from
 * this, and the server validates against the same object. The alternative —
 * a form that knows the fields and a server that knows them separately — is
 * how a required field ends up optional on one side.
 */
export const PROVIDER_SPECS: Record<ProviderId, ProviderSpec> = {
  paystack: {
    id: "paystack",
    name: "Paystack",
    blurb:
      "Cards, bank transfer and USSD. The most common choice for Nigerian churches.",
    dashboardUrl: "https://dashboard.paystack.com/#/settings/developers",
    currencies: ["NGN", "GHS", "ZAR", "KES", "USD"],
    canVerify: true,
    reportsBack: true,
    fields: [
      {
        key: "publicKey",
        label: "Public key",
        hint: "Starts with pk_live_ (or pk_test_ while you're testing).",
        placeholder: "pk_live_…",
        required: true,
      },
      {
        key: "secret",
        label: "Secret key",
        hint: "Starts with sk_live_. Settings → API Keys & Webhooks in Paystack.",
        placeholder: "sk_live_…",
        secret: true,
        required: true,
      },
    ],
  },

  flutterwave: {
    id: "flutterwave",
    name: "Flutterwave",
    blurb:
      "Cards, transfers and mobile money across Africa. Good if your givers are in several countries.",
    dashboardUrl: "https://app.flutterwave.com/dashboard/settings/apis",
    currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "RWF", "USD", "EUR", "GBP"],
    canVerify: true,
    reportsBack: true,
    fields: [
      {
        key: "publicKey",
        label: "Public key",
        hint: "Starts with FLWPUBK.",
        placeholder: "FLWPUBK-…",
        required: true,
      },
      {
        key: "secret",
        label: "Secret key",
        hint: "Starts with FLWSECK. Settings → API in Flutterwave.",
        placeholder: "FLWSECK-…",
        secret: true,
        required: true,
      },
      {
        key: "secretHash",
        label: "Webhook secret hash",
        /*
         * Optional, and the UI says why rather than hiding it. Flutterwave
         * signs a webhook with whatever the merchant typed into the dashboard;
         * without it, nothing can be verified, so unsigned webhooks are
         * ignored and gifts are settled by the giver's redirect alone.
         */
        hint: "Optional. Set the same value here and in Flutterwave → Settings → Webhooks, so we can trust what they send us.",
        secret: true,
      },
    ],
  },

  monnify: {
    id: "monnify",
    name: "Monnify",
    blurb:
      "Bank transfer and cards, with reserved account numbers. Nigeria only.",
    dashboardUrl: "https://app.monnify.com/developer",
    currencies: ["NGN"],
    canVerify: true,
    reportsBack: true,
    fields: [
      {
        key: "publicKey",
        label: "API key",
        hint: "Starts with MK_PROD_. Monnify calls this the API key.",
        placeholder: "MK_PROD_…",
        required: true,
      },
      {
        key: "secret",
        label: "Secret key",
        hint: "Developer → API Keys & Webhooks in Monnify.",
        secret: true,
        required: true,
      },
      {
        key: "contractCode",
        label: "Contract code",
        hint: "The number beside your API keys. Every payment is raised against it.",
        placeholder: "1234567890",
        required: true,
      },
    ],
  },

  link: {
    id: "link",
    name: "A payment link I already have",
    blurb:
      "Already collecting somewhere else? Paste the link and we'll show the button. Nothing comes back to FlockInsight, so you record what lands yourself.",
    currencies: [],
    canVerify: false,
    reportsBack: false,
    fields: [
      {
        key: "linkUrl",
        label: "Your payment link",
        hint: "The full address, including https://",
        placeholder: "https://paystack.shop/your-church",
        required: true,
      },
    ],
  },
};

export const PROVIDER_IDS: ProviderId[] = [
  "paystack",
  "flutterwave",
  "monnify",
  "link",
];

export function providerName(id: string): string {
  return PROVIDER_SPECS[id as ProviderId]?.name ?? id;
}

/**
 * Can this provider charge in this church's currency?
 *
 * Asked before a church is allowed to activate, not when the first giver is
 * standing at a checkout — Monnify is naira-only, and a church in Accra
 * should find that out from us rather than from a failed payment.
 */
export function supportsCurrency(id: ProviderId, currency: string): boolean {
  const spec = PROVIDER_SPECS[id];
  if (!spec || spec.currencies.length === 0) return true;
  return spec.currencies.includes(currency.toUpperCase());
}
