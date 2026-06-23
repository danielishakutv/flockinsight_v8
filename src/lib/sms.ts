import "server-only";

/**
 * SMS sending via Kudisms (https://my.kudisms.net).
 *
 * Configure with env vars:
 *   KUDISMS_API_TOKEN  – your API token
 *   KUDISMS_SENDER_ID  – approved sender ID (max 11 chars)
 *   KUDISMS_GATEWAY    – route/gateway id (optional; defaults to "2")
 */

const KUDISMS_URL = "https://my.kudisms.net/api/sms";

export type SmsResult = { ok: true } | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return !!(process.env.KUDISMS_API_TOKEN && process.env.KUDISMS_SENDER_ID);
}

/**
 * Normalize a (mostly Nigerian) phone number to Kudisms' expected
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

type KudismsResponse = {
  status?: string;
  error_code?: string | number;
  msg?: string;
  message?: string;
};

/** Send an SMS to one or more recipients. */
export async function sendSms(opts: {
  to: string | string[];
  message: string;
}): Promise<SmsResult> {
  const token = process.env.KUDISMS_API_TOKEN;
  const senderId = process.env.KUDISMS_SENDER_ID;
  if (!token || !senderId) {
    return { ok: false, error: "SMS is not configured on the server." };
  }
  const gateway = process.env.KUDISMS_GATEWAY || "2";

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map(normalizePhone)
    .filter((n): n is string => !!n);
  if (!recipients.length) {
    return { ok: false, error: "No valid phone number to send to." };
  }
  if (!opts.message.trim()) {
    return { ok: false, error: "Message is empty." };
  }

  const params = new URLSearchParams({
    token,
    senderID: senderId,
    gateway,
    message: opts.message,
    recipient: recipients.join(","),
  });

  try {
    const res = await fetch(`${KUDISMS_URL}?${params.toString()}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = (await res.json().catch(() => null)) as KudismsResponse | null;

    if (data?.status === "success" && String(data.error_code) === "000") {
      return { ok: true };
    }
    const reason =
      data?.msg || data?.message || `gateway error ${data?.error_code ?? res.status}`;
    return { ok: false, error: `SMS not sent: ${reason}` };
  } catch (e) {
    console.error("[sms] Kudisms send failed:", e);
    return { ok: false, error: "Could not reach the SMS gateway." };
  }
}
