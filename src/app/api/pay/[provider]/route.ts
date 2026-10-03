import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { churchGateway, onlinePayment } from "@/db/schema";
import { adapterFor } from "@/lib/gateways";
import { PROVIDER_IDS } from "@/lib/gateways/specs";
import type { ProviderId } from "@/lib/gateways/types";
import { openJson, openSecret } from "@/lib/secret-box";
import { settleOnlinePayment } from "@/lib/online-giving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pay/<provider> — a gateway telling us a gift completed.
 *
 * ONE URL PER PROVIDER, SHARED BY EVERY CHURCH, which is the only shape that
 * works: a church pastes this into its own dashboard, and we cannot ask it to
 * include an id it would get wrong. So the church is identified from the
 * PAYLOAD — our reference is in there, and `online_payment` says which church
 * it belongs to.
 *
 * WHICH MEANS THE ORDER MATTERS. The reference is read from the body first
 * (unverified, and treated as untrusted), used only to look up which church's
 * keys to check the signature against, and nothing is acted on until that
 * signature verifies against THAT church's own secret. A webhook signed for
 * one church therefore cannot settle another's payment, even though they share
 * a URL.
 *
 * ALWAYS 200, unless the signature fails. Every one of these providers retries
 * on a non-2xx, and retrying is not what fixes "we have no record of that
 * reference" — it just fills our logs and theirs. A refused signature is the
 * one case where 401 is the honest answer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await params;
  const provider = raw as ProviderId;
  if (!PROVIDER_IDS.includes(provider) || provider === "link") {
    return json({ ok: false, error: "Unknown provider." }, 404);
  }

  const adapter = adapterFor(provider);
  if (!adapter) return json({ ok: false, error: "Unknown provider." }, 404);

  /*
   * The RAW body, read once as text.
   *
   * Every one of these signs the exact bytes sent. Parsing to JSON and
   * re-serialising changes them — key order, whitespace, number formatting —
   * and the signature stops matching for reasons nothing in the logs explains.
   */
  const body = await request.text();

  const peeked = peekReference(body);
  if (!peeked) {
    console.warn(`[pay/${provider}] no reference in the payload`);
    return json({ ok: true, ignored: "no reference" });
  }

  const [payment] = await db
    .select({ churchId: onlinePayment.churchId, provider: onlinePayment.provider })
    .from(onlinePayment)
    .where(eq(onlinePayment.reference, peeked))
    .limit(1);
  if (!payment) {
    // A reference we never issued. Normal when a church reuses one gateway
    // account across several systems, so it is logged and accepted.
    console.warn(`[pay/${provider}] reference ${peeked} is not one of ours`);
    return json({ ok: true, ignored: "unknown reference" });
  }

  const [gateway] = await db
    .select()
    .from(churchGateway)
    .where(
      and(
        eq(churchGateway.churchId, payment.churchId),
        eq(churchGateway.provider, provider),
      ),
    )
    .limit(1);
  if (!gateway) {
    console.warn(
      `[pay/${provider}] church ${payment.churchId} has no ${provider} keys stored`,
    );
    return json({ ok: true, ignored: "no keys" });
  }

  const verified = adapter.verifyWebhook(
    {
      publicKey: gateway.publicKey,
      secret: openSecret(gateway.secretSealed),
      extra: openJson(gateway.extraSealed),
      linkUrl: gateway.linkUrl,
    },
    body,
    request.headers,
  );
  if (!verified.ok) {
    /*
     * Logged with the church, because this is what a misconfigured webhook
     * looks like and somebody will have to work out why gifts are only being
     * recorded when the giver's browser comes back.
     */
    console.warn(
      `[pay/${provider}] rejected a webhook for church ${payment.churchId}: ${verified.error}`,
    );
    return json({ ok: false, error: verified.error }, 401);
  }

  /*
   * The reference from the VERIFIED read, not the peek.
   *
   * The peek was untrusted input used only to find the key; this is the one
   * the signed body says. They are the same in every normal case, and
   * preferring this one means a forged peek could never redirect a genuine
   * settlement at somebody else's payment.
   */
  const reference = verified.reference ?? peeked;
  const settled = await settleOnlinePayment(reference);
  if (!settled.ok) {
    console.error(`[pay/${provider}] settle failed for ${reference}: ${settled.error}`);
    return json({ ok: true, settled: false });
  }

  return json({ ok: true, status: settled.status, recorded: settled.recorded });
}

/**
 * Fish our reference out of an unverified body.
 *
 * Deliberately generous about shape and deliberately strict about what it is
 * used for: finding which church's key to check the signature with, and
 * nothing else. Every provider puts it somewhere different, and some put it in
 * two places.
 */
function peekReference(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const data = (body.data ?? body.eventData ?? {}) as Record<string, unknown>;
    const candidates = [
      data.reference,
      data.tx_ref,
      data.paymentReference,
      body.reference,
      body.txRef,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
