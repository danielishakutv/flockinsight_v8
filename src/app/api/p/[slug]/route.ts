import { getPublicContribution } from "@/lib/contributions";

export const dynamic = "force-dynamic";

/**
 * GET /api/p/<slug> — the public figures for one collection.
 *
 * The same projection the page renders, so a browser left open in a WhatsApp
 * in-app view shows the total moving rather than a number frozen at whenever the
 * link was tapped. That matters more than it sounds: the single most common use
 * of this link is twenty people watching a total climb on a Sunday, and a stale
 * figure makes somebody think their payment was not recorded.
 *
 * Deliberately built from `getPublicContribution` rather than a lighter query of
 * its own. Two code paths deciding what the public may see is how one of them
 * ends up leaking the names a church asked to keep private.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const pot = await getPublicContribution(slug);
  if (!pot) return new Response("Not found", { status: 404 });

  return new Response(JSON.stringify(pot), {
    headers: {
      "Content-Type": "application/json",
      // Never cached at the edge: the whole point is that it is current. A
      // shared cache here would hand one church's figures to the next reader
      // for the length of the TTL.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
