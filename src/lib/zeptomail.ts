import "server-only";

/**
 * ZeptoMail (Zoho) transactional email, over its REST API.
 *
 * The API rather than SMTP, for two reasons. It returns a `request_id` we can
 * store against the recipient, which is what makes a per-recipient delivery
 * report possible later — SMTP gives us nothing to reconcile against. And a
 * single HTTPS call from the VPS is more reliable than holding an SMTP
 * connection open, which is the kind of thing that fails quietly at 2am when a
 * cron sends 400 reminders.
 *
 * ZeptoMail refuses any From address outside a verified domain, which is a
 * feature: it is why buildFrom() only ever changes the display name and never
 * the address.
 */

/** Zoho runs separate datacentres; the account decides which one answers. */
const DEFAULT_API = "https://api.zeptomail.com/v1.1/email";

export function zeptoConfigured(): boolean {
  return !!process.env.ZEPTOMAIL_TOKEN;
}

type Address = { address: string; name?: string };

export type ZeptoMessage = {
  from: Address;
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export type ZeptoResult = { ok: boolean; id: string | null; error?: string };

const recipient = (email: string) => ({ email_address: { address: email } });

/**
 * Send one message. Never throws — a failed send is reported, not raised, so
 * one bad address in a broadcast cannot abort the rest of it.
 */
export async function sendViaZepto(msg: ZeptoMessage): Promise<ZeptoResult> {
  const token = process.env.ZEPTOMAIL_TOKEN;
  if (!token) return { ok: false, id: null, error: "ZEPTOMAIL_TOKEN is not set" };
  const url = process.env.ZEPTOMAIL_API_URL || DEFAULT_API;

  const body: Record<string, unknown> = {
    from: msg.from,
    to: [recipient(msg.to)],
    subject: msg.subject,
    htmlbody: msg.html,
  };
  if (msg.text) body.textbody = msg.text;
  if (msg.cc?.length) body.cc = msg.cc.map(recipient);
  if (msg.replyTo) body.reply_to = [{ address: msg.replyTo }];
  if (msg.attachments?.length) {
    body.attachments = msg.attachments.map((a) => ({
      name: a.filename,
      content: a.content.toString("base64"),
      mime_type: a.contentType ?? "application/octet-stream",
    }));
  }

  try {
    // A send that hangs must not hold a cron open indefinitely.
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // Zoho's own scheme. The token already carries its prefix when copied
        // from the console, so don't add a second one.
        Authorization: token.startsWith("Zoho-enczapikey")
          ? token
          : `Zoho-enczapikey ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* ZeptoMail returns JSON; a non-JSON body means something upstream. */
    }

    if (!res.ok) {
      return { ok: false, id: null, error: zeptoError(parsed) ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: requestId(parsed) };
  } catch (e) {
    const msg2 = e instanceof Error ? e.message : String(e);
    return { ok: false, id: null, error: msg2 };
  }
}

/** `request_id` is what the webhook sends back, so it is our message id. */
function requestId(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const v = (parsed as { request_id?: unknown }).request_id;
  return typeof v === "string" && v ? v : null;
}

/**
 * Pull something readable out of an error body. ZeptoMail nests the useful
 * part under `error.details[].message`, with a top-level `message` that is
 * usually just "Bad Request".
 */
function zeptoError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as {
    message?: unknown;
    error?: { message?: unknown; details?: unknown };
  };
  const details = o.error?.details;
  if (Array.isArray(details)) {
    const first = details
      .map((d) =>
        d && typeof d === "object"
          ? [
              (d as { message?: unknown }).message,
              (d as { target?: unknown }).target,
            ]
              .filter((x) => typeof x === "string" && x)
              .join(" — ")
          : "",
      )
      .filter(Boolean)[0];
    if (first) return first;
  }
  for (const v of [o.error?.message, o.message]) {
    if (typeof v === "string" && v) return v;
  }
  return null;
}
