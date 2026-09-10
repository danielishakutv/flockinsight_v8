import crypto from "node:crypto";
import { applyDeliveryReport } from "@/lib/delivery-reports";
import { mapZeptoEvent, zeptoReason } from "@/lib/delivery-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/zeptomail — ZeptoMail delivery events.
 *
 * Configure the URL in the ZeptoMail console under your Mail Agent's
 * Webhooks, appending `?key=<ZEPTOMAIL_WEBHOOK_SECRET>`. ZeptoMail does not
 * sign its payloads the way Resend does, so a shared secret in the URL is the
 * available mechanism; it is compared in constant time and the endpoint does
 * nothing at all without it.
 *
 * The payload shape has moved between ZeptoMail versions, and a delivery
 * report is not worth failing a request over, so the parser is deliberately
 * tolerant: it looks for an event name and a request id wherever they appear,
 * and logs anything it cannot read so the shape can be added rather than
 * guessed at.
 */

function authorised(req: Request): boolean {
  const expected = process.env.ZEPTOMAIL_WEBHOOK_SECRET;
  if (!expected) return false;
  const supplied =
    new URL(req.url).searchParams.get("key") ??
    req.headers.get("x-zeptomail-key") ??
    "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Report = {
  event: string;
  requestId?: string | null;
  email?: string | null;
  reason?: string | null;
};

/** Walk the payload for the fields we need, whatever nesting they arrived in. */
function extract(payload: unknown): Report[] {
  const out: Report[] = [];

  const visit = (node: unknown, inheritedEvent: string | null) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedEvent);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;

    const str = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    };

    const event = str("event_name", "eventname", "event", "type") ?? inheritedEvent;
    const requestId = str("request_id", "requestid", "message_id", "messageid");
    const email =
      str("email_address", "emailaddress", "bounced_recipient", "recipient", "to") ??
      // Sometimes nested as { email_address: { address } }.
      (() => {
        const ea = o["email_address"];
        if (ea && typeof ea === "object") {
          const a = (ea as Record<string, unknown>)["address"];
          if (typeof a === "string") return a;
        }
        return null;
      })();
    const reason = str("reason", "details", "description", "diagnostic_message");

    // A node is a report only once it names an event AND identifies a message.
    if (event && (requestId || email)) {
      out.push({ event, requestId, email, reason });
    }

    for (const v of Object.values(o)) {
      if (v && typeof v === "object") visit(v, event ?? inheritedEvent);
    }
  };

  visit(payload, null);
  return out;
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const raw = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const reports = extract(payload);
  if (reports.length === 0) {
    // Not an error — ZeptoMail sends test pings, and unknown shapes should be
    // visible rather than silently dropped.
    console.warn(
      "[zeptomail] no delivery report found in payload:",
      raw.slice(0, 800),
    );
    return Response.json({ ok: true, applied: 0 });
  }

  let applied = 0;
  for (const r of reports) {
    const state = mapZeptoEvent(r.event);
    if (!state) continue; // opens, clicks — deliberately not recorded
    const res = await applyDeliveryReport({
      providerMessageId: r.requestId ?? null,
      destination: r.email ?? null,
      state,
      reason: zeptoReason(r.event, r.reason),
    });
    if (res === "updated") applied++;
  }

  return Response.json({ ok: true, applied });
}
