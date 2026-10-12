import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, subscriber } from "@/db/schema";
import { decodeUnsubEmail, unsubscribeQuery, verifyUnsubscribe } from "@/lib/devotionals";
import { optOutKey } from "@/lib/devotional-recipients";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Unsubscribe from a church's devotionals and newsletters.
 *
 * GET is the link in the email footer: record the opt-out, then show the
 * /n/unsubscribe page. POST is RFC 8058 one-click unsubscribe - what Gmail's
 * and Yahoo's own "Unsubscribe" button calls through the List-Unsubscribe
 * header, with no page at all.
 *
 * WHY A ROUTE AND NOT ONLY THE PAGE. The page can only mark an EXISTING
 * subscriber row. Somebody who receives these as a member has none, so their
 * click changed nothing - and the next send reached them again. Here the
 * opt-out is written as a row whatever list they came from, and the sender
 * (lib/devotionals.ts resolveRecipients) leaves out everyone with one.
 *
 * The signed token is the authority: the address and church come from a link
 * we signed, so nobody can unsubscribe an address they were not sent.
 */
async function optOut(url: URL): Promise<{ ok: boolean; churchId?: string; email?: string }> {
  const c = url.searchParams.get("c") ?? "";
  const e = url.searchParams.get("e") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!c || !e || !t) return { ok: false };
  const email = decodeUnsubEmail(e);
  if (!email || !verifyUnsubscribe(c, email, t)) return { ok: false };

  // The subscriber row references the church, so a deleted church has nothing
  // left to send from - and nothing to record against.
  const [exists] = await db.select({ id: church.id }).from(church).where(eq(church.id, c)).limit(1);
  if (!exists) return { ok: true, churchId: c, email };

  await db
    .insert(subscriber)
    .values({ churchId: c, email: optOutKey(email), status: "unsubscribed", source: "member" })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      set: { status: "unsubscribed" },
    });
  return { ok: true, churchId: c, email };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const res = await optOut(url);
  // Back to the page either way: it checks the signature itself and says
  // plainly whether the link worked.
  // The public origin, not the one the request arrived on behind the proxy.
  const target = new URL("/n/unsubscribe", siteUrl());
  if (res.ok && res.churchId && res.email) {
    target.search = unsubscribeQuery(res.churchId, res.email);
  } else {
    target.search = url.search;
  }
  return Response.redirect(target, 303);
}

export async function POST(request: Request) {
  const res = await optOut(new URL(request.url));
  if (!res.ok) return new Response("Invalid unsubscribe link", { status: 400 });
  return new Response("Unsubscribed", { status: 200 });
}
