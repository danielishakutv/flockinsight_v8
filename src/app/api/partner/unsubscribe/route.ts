import { z } from "zod";
import { setDigestOptOut, verifyDigestUnsub } from "@/lib/partner-digest";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stop a Partner's twice-weekly progress emails.
 *
 * GET is the link in the email footer: record the opt-out, then show
 * /partner/unsubscribed. POST is RFC 8058 one-click unsubscribe, what a mail
 * app's own "Unsubscribe" button calls through the List-Unsubscribe header.
 * The same shape as the newsletter unsubscribe (api/newsletter/unsubscribe).
 *
 * The signed token is the authority — no sign-in, because the point is that
 * one click works from the inbox — and it is signed for this purpose alone,
 * so nobody can stop a Partner's emails without a link we sent that Partner.
 * Only the progress emails stop: status and payment emails are about their
 * account, and keep coming.
 */
async function optOut(url: URL): Promise<boolean> {
  const p = url.searchParams.get("p") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!z.string().uuid().safeParse(p).success || !t) return false;
  if (!verifyDigestUnsub(p, t)) return false;
  await setDigestOptOut(p, true);
  return true;
}

export async function GET(request: Request) {
  const ok = await optOut(new URL(request.url));
  // The public origin, not the one the request arrived on behind the proxy.
  const target = new URL("/partner/unsubscribed", siteUrl());
  target.searchParams.set("ok", ok ? "1" : "0");
  return Response.redirect(target, 303);
}

export async function POST(request: Request) {
  const ok = await optOut(new URL(request.url));
  if (!ok) return new Response("Invalid unsubscribe link", { status: 400 });
  return new Response("Unsubscribed", { status: 200 });
}
