import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, subscriber } from "@/db/schema";
import { decodeUnsubEmail, verifyResubscribe } from "@/lib/devotionals";
import { optOutKey } from "@/lib/devotional-recipients";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The link in a "receive emails from this church again?" message.
 *
 * The public sign-up form no longer puts an unsubscribed address back on a
 * list - anybody who knew the address could do that, and the person would then
 * get every newsletter after telling the church to stop. It emails the address
 * a signed link instead, and this is that link: only somebody who can read
 * that inbox gets here, so only they can undo their own opt-out.
 *
 * GET ONLY ASKS; POST DOES IT. Mail security scanners (Outlook Safe Links,
 * corporate gateways) open every link in a message before the person sees it.
 * When the GET re-subscribed, typing somebody's address into the public form
 * was enough to put them back on the list without a click from them - the very
 * thing the signed link exists to prevent. Now the GET shows a button, and
 * only pressing it changes anything. A scanner does not press buttons.
 */

type Link = { churchId: string; email: string; handle: string | null } | null;

/** The church and address a link names, if its signature holds. */
async function readLink(url: URL): Promise<Link> {
  const c = url.searchParams.get("c") ?? "";
  const email = decodeUnsubEmail(url.searchParams.get("e") ?? "");
  const issuedAt = Number(url.searchParams.get("a"));
  const token = url.searchParams.get("t") ?? "";
  if (!c || !email || !token || !verifyResubscribe(c, email, issuedAt, token)) return null;
  const [row] = await db
    .select({ handle: church.handle })
    .from(church)
    .where(eq(church.id, c))
    .limit(1);
  return row ? { churchId: c, email, handle: row.handle } : null;
}

const INVALID =
  "<h1>This link has expired or is not valid</h1><p>Links like this work for seven days. Sign up again from the church's page to get a new one.</p>";

function page(body: string, link: Link, status: number): Response {
  const back = link?.handle
    ? `<p><a href="${siteUrl()}/c/${encodeURIComponent(link.handle)}">Back to the church's page</a></p>`
    : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Newsletter</title></head><body style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1626;line-height:1.6">${body}${back}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The page carries a signed link in its form; nothing should keep it.
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

export async function GET(request: Request) {
  const link = await readLink(new URL(request.url));
  if (!link) return page(INVALID, null, 400);
  // No action attribute: the form posts back to this exact URL, signature and all.
  return page(
    `<h1>Receive this church's emails again?</h1><p>Press the button to get its devotionals and newsletters by email again. Every email has an unsubscribe link if you change your mind.</p><form method="post"><button type="submit" style="font:inherit;font-weight:700;background:#5b3df5;color:#fff;border:0;border-radius:10px;padding:12px 20px;cursor:pointer">Yes, send me these emails</button></form>`,
    link,
    200,
  );
}

export async function POST(request: Request) {
  const link = await readLink(new URL(request.url));
  if (!link) return page(INVALID, null, 400);

  /*
   * Upserted, and believed only when the database says a row was written. The
   * old version answered "You're subscribed again" whether or not its UPDATE
   * matched anything - say the row had been removed since - and the person
   * then waited for emails that were never going to come.
   */
  const written = await db
    .insert(subscriber)
    .values({ churchId: link.churchId, email: optOutKey(link.email), status: "active", source: "public" })
    .onConflictDoUpdate({
      target: [subscriber.churchId, subscriber.email],
      set: { status: "active" },
    })
    .returning({ id: subscriber.id });
  if (written.length === 0) {
    console.error(
      `[newsletter] re-subscribe for church ${link.churchId} wrote no row; the person was told it did not work`,
    );
    return page(
      "<h1>That did not work</h1><p>We could not put you back on the list just now. Please try the link again in a few minutes.</p>",
      link,
      500,
    );
  }
  return page(
    "<h1>You're subscribed again</h1><p>You'll receive this church's devotionals and newsletters by email. Every email has an unsubscribe link if you change your mind.</p>",
    link,
    200,
  );
}
