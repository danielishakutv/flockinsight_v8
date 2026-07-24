import "server-only";

/**
 * SMS via Termii (https://developers.termii.com/messaging).
 *
 * Env vars:
 *   TERMII_API_KEY    – your Termii API key (required)
 *   TERMII_SENDER_ID  – platform default approved sender ID, e.g. "TEDxYola"
 *   TERMII_BASE_URL   – API base (optional; default https://v3.api.termii.com)
 *   TERMII_CHANNEL    – "generic" | "dnd" | "whatsapp" (optional; default generic)
 *                       Set to "dnd" to reach numbers on the DND list.
 */

export function termiiBase(): string {
  return (process.env.TERMII_BASE_URL || "https://v3.api.termii.com").replace(/\/$/, "");
}

export type SmsResult = { ok: true } | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return !!(process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID);
}

/**
 * Normalize a (mostly Nigerian) phone number to Termii's expected
 * international format without the leading "+": e.g. 0803… → 234803…,
 * +234803… → 234803…. Returns null if it can't be made sensible.
 */
export function normalizePhone(input: string): string | null {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("234")) return digits.length === 13 ? digits : null;
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return rest.length === 10 ? `234${rest}` : null;
  }
  if (digits.length === 10) return `234${digits}`;
  // Already international (other country) — send as-is.
  return digits.length >= 10 ? digits : null;
}

type TermiiSendResponse = {
  message_id?: string;
  message_id_list?: string[];
  code?: string;
  message?: string;
  balance?: number;
};

// Page maths lives in a client-safe module so composers can use it too.
export { smsPages } from "@/lib/sms-pages";

/** Send an SMS to one or more recipients. `senderId` overrides the env one. */
export async function sendSms(opts: {
  to: string | string[];
  message: string;
  senderId?: string;
}): Promise<SmsResult> {
  const apiKey = process.env.TERMII_API_KEY;
  const from = opts.senderId || process.env.TERMII_SENDER_ID;
  if (!apiKey || !from) {
    return { ok: false, error: "SMS is not configured on the server." };
  }
  const channel = process.env.TERMII_CHANNEL || "generic";

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map(normalizePhone)
    .filter((n): n is string => !!n);
  if (!recipients.length) {
    return { ok: false, error: "No valid phone number to send to." };
  }
  if (!opts.message.trim()) {
    return { ok: false, error: "Message is empty." };
  }

  // Single recipient → /sms/send ; multiple → /sms/send/bulk (array `to`).
  const bulk = recipients.length > 1;
  const url = `${termiiBase()}/api/sms/send${bulk ? "/bulk" : ""}`;
  const body = {
    to: bulk ? recipients : recipients[0],
    from,
    sms: opts.message,
    type: "plain",
    channel,
    api_key: apiKey,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as TermiiSendResponse | null;

    const success =
      !!data &&
      (!!data.message_id ||
        (Array.isArray(data.message_id_list) && data.message_id_list.length > 0) ||
        data.code === "ok" ||
        /success/i.test(String(data.message ?? "")));
    if (res.ok && success) return { ok: true };

    return {
      ok: false,
      error: `SMS not sent: ${data?.message || `gateway error ${res.status}`}`,
    };
  } catch (e) {
    console.error("[sms] Termii send failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}
